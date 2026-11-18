-- =====================================================================
-- FisioAgenda — versione pilota: paziente indicato solo con il CODICE CARTELLA (anonimato).
-- Il campo patients.name contiene il codice cartella. Il server lo controlla sempre:
-- - lettere, cifre, spazio e / . - _ ; da 1 a 20 caratteri; almeno una cifra (un nome non passa);
-- - un codice = un paziente (maiuscole/minuscole e spazi non contano).
-- I dati già presenti non vengono toccati: per ripartire puliti c'è «Svuota pazienti e sedute».
-- Si può eseguire più volte.
-- =====================================================================

create or replace function app.code_key(p text) returns text language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(p, '')), '\s+', '', 'g'))
$$;

create or replace function app.check_patient_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- il ripristino da backup rimette i dati com'erano
  if current_setting('app.restoring', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then return new; end if;
  new.name := regexp_replace(trim(coalesce(new.name, '')), '\s+', ' ', 'g');
  if new.name = '' then
    perform app.fail('Scrivi il codice cartella del paziente.');
  end if;
  if length(new.name) > 20 or new.name !~* '^[a-z0-9 /._-]+$' then
    perform app.fail('Codice cartella «' || left(new.name, 30) || '» non valido: usa solo lettere, cifre e / . - _ (al massimo 20 caratteri). Niente nomi e cognomi.');
  end if;
  if new.name !~ '[0-9]' then
    perform app.fail('«' || new.name || '» non sembra un codice cartella: deve contenere almeno una cifra. Per l''anonimato non scrivere nomi e cognomi.');
  end if;
  if exists (select 1 from public.patients p where app.code_key(p.name) = app.code_key(new.name) and p.id <> new.id) then
    perform app.fail('Esiste già un paziente con il codice cartella ' || new.name || ': cercalo e usa quello.');
  end if;
  return new;
end $$;
revoke all on function app.check_patient_code() from public, anon;

drop trigger if exists check_patient_code on public.patients;
create trigger check_patient_code before insert or update of name on public.patients
  for each row execute function app.check_patient_code();

-- messaggi e storico: «codice cartella», non «nome»
create or replace function public.update_patient(p_id uuid, p_version int, p_name text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.patients;
begin
  perform app.require_role('operatore');
  select * into v from public.patients where id = p_id for update;
  if not found then perform app.fail('Paziente non trovato.'); end if;
  if v.version <> p_version then perform app.stale('Il paziente', v.updated_by); end if;
  if trim(coalesce(p_name, '')) = '' then perform app.fail('Il codice cartella non può essere vuoto.'); end if;
  update public.patients set name = trim(p_name), note = coalesce(p_note, '') where id = p_id;
  perform app.log('paziente', 'Paziente ' || v.name || case when app.code_key(v.name) <> app.code_key(p_name) then ': codice cartella cambiato in ' || trim(p_name) else ': nota modificata' end || '.', 'patient', p_id::text, null);
end $$;
