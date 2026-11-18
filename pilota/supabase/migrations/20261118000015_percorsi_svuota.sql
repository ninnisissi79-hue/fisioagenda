-- =====================================================================
-- FisioAgenda — versione pilota: percorsi «Linfodrenaggio» e «Breast unit»;
-- «Svuota pazienti e sedute» toglie anche lo storico che riguarda i pazienti (nessun vecchio nome resta).
-- Si può eseguire più volte: i percorsi si aggiungono solo la prima volta.
-- =====================================================================

do $$
declare c record;
begin
  for c in select * from (values ('linfodrenaggio', 'Linfodrenaggio', 15), ('breast_unit', 'Breast unit', 16)) v(id, name, sort) loop
    if not exists (select 1 from public.categories where id = c.id) then
      insert into public.categories (id, name, sort) values (c.id, c.name, c.sort);
      -- competenze di partenza: come per il Linfedema (si cambiano da Impostazioni → Fisioterapisti)
      insert into public.therapist_skills (therapist_id, category_id, level)
      select s.therapist_id, c.id, s.level from public.therapist_skills s where s.category_id = 'linf'
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- svuotamento completo dei pazienti: sedute, cicli, avvisi e storico che li riguarda.
-- Restano fisioterapisti, account, orari, ferie, percorsi, festività e lo storico di questi.
create or replace function app.clear_patients() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p int; v_a int; v_l int;
begin
  select count(*) into v_p from public.patients;
  select count(*) into v_a from public.appointments;
  perform set_config('app.restoring', 'on', true);
  delete from public.therapist_alerts where true;
  delete from public.patient_events where true;
  update public.appointments set recovery_of = null, recovered_by = null where recovery_of is not null or recovered_by is not null;
  delete from public.appointments where true;
  delete from public.cycles where true;
  delete from public.patients where true;
  delete from public.import_batches where true;
  delete from public.row_changes where tbl in ('patients', 'cycles', 'appointments', 'patient_events', 'import_batches');
  delete from public.audit_log
   where entity in ('patient', 'cycle', 'appointment', 'import')
      or action in ('prenotazione', 'richiesta', 'importazione', 'ciclo', 'visita', 'spostamento', 'sostituzione', 'paziente',
                    'chiusura', 'sospensione', 'ripresa', 'scambio', 'recupero', 'modifica_ciclo', 'esito', 'eliminazione',
                    'da_riprogrammare', 'annullamento', 'cambio_stabile', 'dati_demo');
  get diagnostics v_l = row_count;
  delete from public.change_seen s where not exists (select 1 from public.audit_log l where l.id = s.audit_id);
  perform set_config('app.restoring', 'off', true);
  perform app.log('svuotamento', 'Archivio dei pazienti svuotato: ' || v_p || ' pazienti e ' || v_a || ' sedute eliminati, con il loro storico. Fisioterapisti, orari e assenze restano.',
    null, null, jsonb_build_object('patients', v_p, 'appointments', v_a, 'history', v_l));
  return jsonb_build_object('patients', v_p, 'appointments', v_a, 'history', v_l);
end $$;
revoke all on function app.clear_patients() from public, anon, authenticated;

create or replace function public.admin_clear_patients(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('admin');
  if coalesce(p_confirm, '') <> 'SVUOTA' then perform app.fail('Per confermare scrivi SVUOTA.'); end if;
  return app.clear_patients();
end $$;
revoke all on function public.admin_clear_patients(text) from public, anon;
grant execute on function public.admin_clear_patients(text) to authenticated;

-- ---------------------------------------------------------------------
-- Competenze (percorsi) gestite dall'amministratore in un solo passo:
-- nome (il codice si crea da solo) e, per ogni fisioterapista, specifica / abilitato / nessuna.
-- p_skills: { "<therapist_id>": "specifica" | "abilitato" | "" } — chi non è indicato resta com'è.
-- ---------------------------------------------------------------------
create or replace function public.admin_save_competence(p_id text, p_name text, p_active boolean, p_skills jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := nullif(trim(coalesce(p_id, '')), ''); v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
        v_base text; v_n int := 1; k text; v text; v_sp int := 0; v_ab int := 0;
begin
  perform app.require_role('admin');
  if v_name = '' then perform app.fail('Scrivi il nome della competenza.'); end if;
  if length(v_name) > 60 then perform app.fail('Nome troppo lungo (al massimo 60 caratteri).'); end if;
  if exists (select 1 from public.categories c where lower(c.name) = lower(v_name) and c.id is distinct from v_id) then
    perform app.fail('Esiste già una competenza «' || v_name || '».');
  end if;
  if v_id is null then
    v_base := coalesce(nullif(left(replace(app.norm_name(v_name), ' ', '_'), 30), ''), 'competenza');
    v_id := v_base;
    while exists (select 1 from public.categories where id = v_id) loop v_n := v_n + 1; v_id := v_base || '_' || v_n; end loop;
    insert into public.categories (id, name, active, sort)
    values (v_id, v_name, coalesce(p_active, true), coalesce((select max(sort) from public.categories), 0) + 1);
  else
    update public.categories set name = v_name, active = coalesce(p_active, active) where id = v_id;
    if not found then perform app.fail('Competenza non trovata.'); end if;
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_skills, '{}'::jsonb)) loop
    if not exists (select 1 from public.therapists where id::text = k) then continue; end if;
    if coalesce(v, '') = '' then
      delete from public.therapist_skills where therapist_id = k::uuid and category_id = v_id;
    elsif v in ('specifica', 'abilitato') then
      insert into public.therapist_skills (therapist_id, category_id, level) values (k::uuid, v_id, v)
      on conflict (therapist_id, category_id) do update set level = excluded.level;
    else
      perform app.fail('Livello non valido: ' || v);
    end if;
  end loop;
  select count(*) filter (where level = 'specifica'), count(*) filter (where level = 'abilitato') into v_sp, v_ab
    from public.therapist_skills where category_id = v_id;
  perform app.log('configurazione', 'Competenza «' || v_name || '» salvata: ' || v_sp || ' con competenza specifica, ' || v_ab || ' abilitati.', 'category', v_id, null);
  return v_id;
end $$;
revoke all on function public.admin_save_competence(text, text, boolean, jsonb) from public, anon;
grant execute on function public.admin_save_competence(text, text, boolean, jsonb) to authenticated;
