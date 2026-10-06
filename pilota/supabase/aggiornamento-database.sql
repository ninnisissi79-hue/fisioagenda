-- FisioAgenda pilota: AGGIORNAMENTO del database esistente (sedute già svolte, ruoli, previsione cicli, tipi di fascia, calendario flessibile, importazione dei tabulati e correzioni rapide, importazione meno rigida, durata per singola seduta e sostituzioni).
-- Si può eseguire anche più volte: SQL Editor → New query → incolla → Run.

-- =====================================================================
-- FisioAgenda — versione pilota: cicli già in corso al momento dell'inserimento.
-- "Sedute già svolte" (prior_sessions): contate come effettuate, si prenotano
-- solo le sedute rimanenti. Si può eseguire una volta su un database esistente.
-- =====================================================================
alter table public.cycles add column if not exists prior_sessions int not null default 0;
do $$ begin
  alter table public.cycles add constraint cycles_prior_sessions_check check (prior_sessions >= 0 and prior_sessions < planned_sessions);
exception when duplicate_object then null; end $$;

create or replace function public.create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_cyc uuid; v_name text;
begin
  perform app.require_role('operatore');
  v_pat := nullif(p->>'patient_id', '')::uuid;
  if v_pat is null then
    v_name := trim(coalesce(p->>'patient_name', ''));
    if v_name = '' then perform app.fail('Indica il nome (fittizio) del paziente.'); end if;
    insert into public.patients (name, note) values (v_name, coalesce(p->>'patient_note', '')) returning id into v_pat;
  else
    select name into v_name from public.patients where id = v_pat;
    if not found then perform app.fail('Paziente non trovato.'); end if;
  end if;
  if not exists (select 1 from public.categories where id = p->>'category_id') then perform app.fail('Scegli il percorso.'); end if;
  insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays, preference, note, created_by)
  values (v_pat, p->>'category_id', coalesce(p->>'priority', 'NI'), coalesce(p->>'request_type', 'prima'),
          coalesce((p->>'duration')::int, 30), coalesce((p->>'planned_sessions')::int, 10), coalesce(nullif(p->>'prior_sessions', '')::int, 0),
          coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{}'),
          coalesce(p->>'preference', ''), coalesce(p->>'note', ''), auth.uid())
  returning id into v_cyc;
  perform app.log('richiesta', 'Nuova richiesta per ' || v_name || ' inserita in lista d''attesa.', 'cycle', v_cyc::text, p);
  return jsonb_build_object('patient_id', v_pat, 'cycle_id', v_cyc);
end $$;

create or replace function public.book_cycle(p_cycle uuid, p_version int, p_therapist uuid, p_start time, p_weekdays int[], p_dates date[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_d date; v_msg text; v_end time; v_n int := 0; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Richiesta non trovata.'); end if;
  if c.version <> p_version then perform app.stale('La richiesta', c.updated_by); end if;
  if c.status <> 'in_attesa' then perform app.fail('Il ciclo è già stato prenotato.', 'FA_CONFLICT'); end if;
  if coalesce(array_length(p_dates, 1), 0) <> c.planned_sessions - c.prior_sessions then
    perform app.fail('Servono ' || (c.planned_sessions - c.prior_sessions) || ' date (sedute ancora da svolgere), ne sono state indicate ' || coalesce(array_length(p_dates, 1), 0) || '.');
  end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  select name into v_pname from public.patients where id = c.patient_id;
  v_end := p_start + make_interval(mins => c.duration);
  foreach v_d in array (select array_agg(d order by d) from unnest(p_dates) d) loop
    if v_d < app.today() then perform app.fail('La data ' || app.fmt_d(v_d) || ' è già passata.'); end if;
    v_msg := app.check_slot(p_therapist, v_d, p_start, v_end, c.patient_id, null, c.id, true);
    if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(v_d) || ': ' || v_msg, 'FA_SLOT'); end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, p_start, v_end, auth.uid());
    v_n := v_n + 1;
  end loop;
  update public.cycles set status = 'attivo', therapist_id = p_therapist, start_time = p_start,
    weekdays = coalesce(p_weekdays, weekdays) where id = c.id;
  perform app.log('prenotazione', 'Prenotato il ciclo di ' || v_pname || ' con ' || app.th_name(p_therapist) || ': ' || v_n
    || ' sedute dalle ' || app.fmt_t(p_start) || ', dal ' || app.fmt_d(p_dates[1]) || '.', 'cycle', c.id::text,
    jsonb_build_object('therapist_id', p_therapist, 'start', p_start, 'dates', p_dates));
  return jsonb_build_object('booked', v_n);
exception when exclusion_violation then
  raise exception 'Il posto è stato appena prenotato da un altro utente. Nessuna seduta è stata salvata: aggiorna la ricerca.' using hint = 'FA_SLOT';
end $$;

create or replace function public.close_cycle(p_cycle uuid, p_version int, p_reason text, p_from date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_n int; v_done int; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status = 'chiuso' then perform app.fail('Il ciclo è già chiuso.', 'FA_CONFLICT'); end if;
  if trim(coalesce(p_reason, '')) = '' then perform app.fail('Indica il motivo della chiusura.'); end if;
  if p_from < app.today() then perform app.fail('La chiusura non può partire da una data passata.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  update public.appointments set status = 'liberata', freed_for = 'chiusura', reason = 'Ciclo chiuso: ' || p_reason
   where cycle_id = c.id and day >= p_from and status in ('programmata', 'trattenuta', 'da_riprogrammare');
  get diagnostics v_n = row_count;
  select count(*) + c.prior_sessions into v_done from public.appointments where cycle_id = c.id and status = 'effettuata';
  update public.cycles set status = 'chiuso', closed_reason = p_reason, closed_at = p_from,
    forecast = 'conclusione_confermata' where id = c.id;
  perform app.log('chiusura', 'Ciclo di ' || v_pname || ' chiuso dal ' || app.fmt_d(p_from) || ' (' || p_reason || '): '
    || v_done || ' sedute effettuate su ' || c.planned_sessions || ' previste; ' || v_n || ' appuntamenti futuri liberati.',
    'cycle', c.id::text, null);
  return jsonb_build_object('freed', v_n, 'done', v_done);
end $$;

revoke all on function public.create_request(jsonb) from public, anon;
grant execute on function public.create_request(jsonb) to authenticated;
revoke all on function public.book_cycle(uuid, int, uuid, time, int[], date[]) from public, anon;
grant execute on function public.book_cycle(uuid, int, uuid, time, int[], date[]) to authenticated;
revoke all on function public.close_cycle(uuid, int, text, date) from public, anon;
grant execute on function public.close_cycle(uuid, int, text, date) to authenticated;

-- =====================================================================
-- FisioAgenda — versione pilota
-- 1) Ruolo "fisioterapista": modifica SOLO il proprio calendario.
--    Coordinatore (admin) e segreteria/operatore modificano tutti i calendari.
--    Il controllo è fatto dal database (trigger), qualunque sia l'operazione.
-- 2) Previsione dei cicli: ciclo n. X di Y previsti, ipotetica o confermata.
-- Si può eseguire una volta su un database esistente.
-- =====================================================================

-- ---------------- ruoli ----------------
alter table public.profiles add column if not exists therapist_id uuid references public.therapists(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_role_check;
-- (comprende già 'programmatore', così il file si può rieseguire anche dopo l'aggiornamento successivo)
alter table public.profiles add constraint profiles_role_check check (role in ('programmatore', 'admin', 'operatore', 'fisioterapista', 'lettura'));

-- 'operatore' come livello minimo = chiunque possa modificare qualcosa (il fisioterapista solo il proprio calendario)
create or replace function app.require_role(p_min text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare r text := app.my_role();
begin
  if r is null then
    raise exception 'Accesso non autorizzato: account non riconosciuto o disattivato.' using errcode = '42501', hint = 'FA_AUTH';
  end if;
  if p_min = 'operatore' and r not in ('admin', 'operatore', 'fisioterapista') then
    raise exception 'Permesso negato: il tuo profilo è di sola consultazione.' using errcode = '42501', hint = 'FA_PERM';
  end if;
  if p_min = 'admin' and r <> 'admin' then
    raise exception 'Permesso negato: operazione riservata al coordinatore.' using errcode = '42501', hint = 'FA_PERM';
  end if;
end $$;

create or replace function app.my_therapist() returns uuid
language sql stable security definer set search_path = '' as $$
  select therapist_id from public.profiles where user_id = auth.uid() and active
$$;

-- Il fisioterapista può creare o modificare solo righe del proprio calendario.
create or replace function app.guard_own_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_own uuid; v_bad boolean := false;
begin
  if app.my_role() is distinct from 'fisioterapista' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_own := app.my_therapist();
  if v_own is null then
    raise exception 'Il tuo account non è collegato a un fisioterapista: chiedi al coordinatore di collegarlo.' using errcode = '42501', hint = 'FA_PERM';
  end if;
  if tg_table_name in ('appointments', 'absences') then
    v_bad := (tg_op <> 'INSERT' and old.therapist_id is distinct from v_own) or (tg_op <> 'DELETE' and new.therapist_id is distinct from v_own);
  elsif tg_table_name = 'cycles' then
    v_bad := (tg_op <> 'INSERT' and old.therapist_id is not null and old.therapist_id is distinct from v_own)
          or (tg_op <> 'DELETE' and new.therapist_id is not null and new.therapist_id is distinct from v_own);
  end if;
  if v_bad then
    raise exception 'Puoi modificare solo il tuo calendario (%). Per i calendari dei colleghi rivolgiti alla segreteria o al coordinatore.',
      coalesce(app.th_name(v_own), '') using errcode = '42501', hint = 'FA_PERM';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists guard_own on public.appointments;
drop trigger if exists guard_own on public.cycles;
drop trigger if exists guard_own on public.absences;
create trigger guard_own before insert or update or delete on public.appointments for each row execute function app.guard_own_calendar();
create trigger guard_own before insert or update or delete on public.cycles for each row execute function app.guard_own_calendar();
create trigger guard_own before insert or update or delete on public.absences for each row execute function app.guard_own_calendar();

create or replace function public.whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where user_id = auth.uid();
  if not found then return jsonb_build_object('role', null, 'today', app.today()); end if;
  return jsonb_build_object('user_id', v.user_id, 'email', v.email, 'full_name', v.full_name,
    'role', case when v.active then v.role end, 'active', v.active, 'therapist_id', v.therapist_id, 'today', app.today(), 'now', now());
end $$;

drop function if exists public.admin_set_user(uuid, text, boolean, text);
create or replace function public.admin_set_user(p_user uuid, p_role text, p_active boolean, p_full_name text, p_therapist uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  perform app.require_role('admin');
  select * into v from public.profiles where user_id = p_user for update;
  if not found then perform app.fail('Utente non trovato.'); end if;
  if p_role not in ('admin', 'operatore', 'fisioterapista', 'lettura') then perform app.fail('Ruolo non valido.'); end if;
  if p_role = 'fisioterapista' and p_therapist is null then perform app.fail('Per il ruolo Fisioterapista scegli a quale collega corrisponde l''account.'); end if;
  if v.role = 'admin' and (p_role <> 'admin' or not p_active)
     and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    perform app.fail('Deve restare almeno un coordinatore attivo.');
  end if;
  update public.profiles set role = p_role, active = p_active, full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    therapist_id = p_therapist where user_id = p_user;
  perform app.log('utenti', 'Account ' || v.email || ': ruolo ' || p_role
    || case when p_therapist is not null then ' (' || coalesce(app.th_name(p_therapist), '') || ')' else '' end
    || case when p_active then '' else ', disattivato' end || '.', 'profile', p_user::text, null);
end $$;

-- ---------------- previsione dei cicli ----------------
alter table public.cycles add column if not exists cycle_number int not null default 1;
alter table public.cycles add column if not exists expected_cycles int;
alter table public.cycles add column if not exists expected_certain boolean not null default false;
do $$ begin
  alter table public.cycles add constraint cycles_expected_check
    check (cycle_number between 1 and 20 and (expected_cycles is null or (expected_cycles between 1 and 20 and expected_cycles >= cycle_number)));
exception when duplicate_object then null; end $$;

create or replace function public.create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_cyc uuid; v_name text;
begin
  perform app.require_role('operatore');
  v_pat := nullif(p->>'patient_id', '')::uuid;
  if v_pat is null then
    v_name := trim(coalesce(p->>'patient_name', ''));
    if v_name = '' then perform app.fail('Indica il nome (fittizio) del paziente.'); end if;
    insert into public.patients (name, note) values (v_name, coalesce(p->>'patient_note', '')) returning id into v_pat;
  else
    select name into v_name from public.patients where id = v_pat;
    if not found then perform app.fail('Paziente non trovato.'); end if;
  end if;
  if not exists (select 1 from public.categories where id = p->>'category_id') then perform app.fail('Scegli il percorso.'); end if;
  insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions,
    cycle_number, expected_cycles, expected_certain, weekdays, preference, note, created_by)
  values (v_pat, p->>'category_id', coalesce(p->>'priority', 'NI'), coalesce(p->>'request_type', 'prima'),
          coalesce((p->>'duration')::int, 30), coalesce((p->>'planned_sessions')::int, 10), coalesce(nullif(p->>'prior_sessions', '')::int, 0),
          coalesce(nullif(p->>'cycle_number', '')::int, 1), nullif(p->>'expected_cycles', '')::int, coalesce((p->>'expected_certain')::boolean, false),
          coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{}'),
          coalesce(p->>'preference', ''), coalesce(p->>'note', ''), auth.uid())
  returning id into v_cyc;
  perform app.log('richiesta', 'Nuova richiesta per ' || v_name || ' inserita in lista d''attesa.', 'cycle', v_cyc::text, p);
  return jsonb_build_object('patient_id', v_pat, 'cycle_id', v_cyc);
exception when check_violation then
  raise exception 'Dati del ciclo non coerenti: controlla sedute già svolte e numero di cicli previsti.' using hint = 'FA_INPUT';
end $$;

create or replace function public.update_cycle_info(p_cycle uuid, p_version int, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cycles;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  update public.cycles set
    priority = coalesce(p->>'priority', priority),
    request_type = coalesce(p->>'request_type', request_type),
    forecast = coalesce(p->>'forecast', forecast),
    preference = coalesce(p->>'preference', preference),
    note = coalesce(p->>'note', note),
    duration = case when status = 'in_attesa' then coalesce((p->>'duration')::int, duration) else duration end,
    planned_sessions = coalesce((p->>'planned_sessions')::int, planned_sessions),
    cycle_number = coalesce(nullif(p->>'cycle_number', '')::int, cycle_number),
    expected_cycles = case when p ? 'expected_cycles' then nullif(p->>'expected_cycles', '')::int else expected_cycles end,
    expected_certain = coalesce((p->>'expected_certain')::boolean, expected_certain),
    category_id = case when status = 'in_attesa' then coalesce(p->>'category_id', category_id) else category_id end,
    weekdays = case when status = 'in_attesa' and p ? 'weekdays'
                    then coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{}')
                    else weekdays end
  where id = p_cycle;
  perform app.log('ciclo', 'Dati del ciclo di ' || (select name from public.patients where id = c.patient_id) || ' modificati.',
    'cycle', p_cycle::text, p);
exception when check_violation then
  raise exception 'Dati del ciclo non coerenti: controlla sedute e numero di cicli previsti.' using hint = 'FA_INPUT';
end $$;

-- ---------------- permessi delle funzioni ----------------
revoke all on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;
revoke all on function public.admin_set_user(uuid, text, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_user(uuid, text, boolean, text, uuid) to authenticated;
revoke all on function public.create_request(jsonb) from public, anon;
grant execute on function public.create_request(jsonb) to authenticated;
revoke all on function public.update_cycle_info(uuid, int, jsonb) from public, anon;
grant execute on function public.update_cycle_info(uuid, int, jsonb) to authenticated;
revoke all on function app.my_therapist(), app.guard_own_calendar() from public, anon;

-- =====================================================================
-- FisioAgenda — versione pilota: ruolo "programmatore".
-- Programmatore e coordinatore hanno entrambi accesso completo
-- (configurazione, utenti, backup, storico tecnico, tutti i calendari).
-- Si può eseguire più volte su un database esistente.
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('programmatore', 'admin', 'operatore', 'fisioterapista', 'lettura'));

create or replace function app.is_full() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() in ('admin', 'programmatore'), false)
$$;
revoke all on function app.is_full() from public, anon;
grant execute on function app.is_full() to authenticated;

create or replace function app.require_role(p_min text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare r text := app.my_role();
begin
  if r is null then
    raise exception 'Accesso non autorizzato: account non riconosciuto o disattivato.' using errcode = '42501', hint = 'FA_AUTH';
  end if;
  if p_min = 'operatore' and r not in ('programmatore', 'admin', 'operatore', 'fisioterapista') then
    raise exception 'Permesso negato: il tuo profilo è di sola consultazione.' using errcode = '42501', hint = 'FA_PERM';
  end if;
  if p_min = 'admin' and r not in ('programmatore', 'admin') then
    raise exception 'Permesso negato: operazione riservata al coordinatore o al programmatore.' using errcode = '42501', hint = 'FA_PERM';
  end if;
end $$;

drop policy if exists lettura on public.profiles;
create policy lettura on public.profiles for select to authenticated using (user_id = auth.uid() or app.is_full());
drop policy if exists lettura on public.row_changes;
create policy lettura on public.row_changes for select to authenticated using (app.is_full());

create or replace function public.admin_set_user(p_user uuid, p_role text, p_active boolean, p_full_name text, p_therapist uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  perform app.require_role('admin');
  select * into v from public.profiles where user_id = p_user for update;
  if not found then perform app.fail('Utente non trovato.'); end if;
  if p_role not in ('programmatore', 'admin', 'operatore', 'fisioterapista', 'lettura') then perform app.fail('Ruolo non valido.'); end if;
  if p_role = 'fisioterapista' and p_therapist is null then perform app.fail('Per il ruolo Fisioterapista scegli a quale collega corrisponde l''account.'); end if;
  if v.role in ('admin', 'programmatore') and (p_role not in ('admin', 'programmatore') or not p_active)
     and (select count(*) from public.profiles where role in ('admin', 'programmatore') and active) <= 1 then
    perform app.fail('Deve restare almeno un account attivo con accesso completo (programmatore o coordinatore).');
  end if;
  update public.profiles set role = p_role, active = p_active, full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    therapist_id = case when p_role = 'fisioterapista' then p_therapist end where user_id = p_user;
  perform app.log('utenti', 'Account ' || v.email || ': ruolo ' || p_role
    || case when p_role = 'fisioterapista' and p_therapist is not null then ' (' || coalesce(app.th_name(p_therapist), '') || ')' else '' end
    || case when p_active then '' else ', disattivato' end || '.', 'profile', p_user::text, null);
end $$;
revoke all on function public.admin_set_user(uuid, text, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_user(uuid, text, boolean, text, uuid) to authenticated;

-- primo accesso completo: se esiste già un coordinatore o un programmatore non fa nulla
create or replace function app.set_first_admin(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where role in ('admin', 'programmatore') and active) then
    return 'Esiste già un account con accesso completo: usa la sezione Utenti dell''applicazione.';
  end if;
  update public.profiles set role = 'admin', active = true where lower(email) = lower(trim(p_email));
  if not found then return 'Nessun account con questa email: crealo prima in Authentication → Users.'; end if;
  insert into public.audit_log (user_name, action, summary) values ('sistema', 'utenti', 'Primo coordinatore impostato: ' || p_email);
  return 'Fatto: ' || p_email || ' è coordinatore.';
end $$;
revoke all on function app.set_first_admin(text) from public, anon, authenticated;

-- =====================================================================
-- FisioAgenda — versione pilota: tipi di fascia nel calendario di ogni collega.
-- Solo "amb" (Ambulatorio) riceve pazienti; tutte le altre fasce bloccano.
-- Si può eseguire più volte.
-- =====================================================================
create or replace function app.block_label(k text) returns text language sql immutable as $$
  select case k
    when 'amb' then 'ambulatorio' when 'reparto' then 'reparto' when 'pausa' then 'pausa'
    when 'documentazione' then 'cartelle / adempimenti burocratici' when 'segreteria' then 'segreteria'
    when 'corso' then 'corso obbligatorio' when 'permesso_ore' then 'permesso a ore' when 'recupero_ore' then 'recupero ore'
    when 'briefing' then 'briefing' when 'preparazione' then 'preparazione' else 'altra attività' end
$$;

create or replace function app.validate_blocks(p jsonb, p_where text) returns void
language plpgsql immutable as $$
declare x jsonb; v_prev time; v_s time; v_e time;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception '%: fasce non valide.', p_where using hint = 'FA_INPUT'; end if;
  for x in select e from jsonb_array_elements(p) e order by (e->>'start')::time loop
    if coalesce(x->>'kind', '') not in ('amb', 'reparto', 'pausa', 'documentazione', 'segreteria', 'corso', 'permesso_ore', 'recupero_ore',
                                        'briefing', 'preparazione', 'altro') then
      raise exception '%: tipo di fascia non valido.', p_where using hint = 'FA_INPUT';
    end if;
    if nullif(x->>'start', '') is null or nullif(x->>'end', '') is null then
      raise exception '%: indica inizio e fine di ogni fascia.', p_where using hint = 'FA_INPUT';
    end if;
    v_s := (x->>'start')::time; v_e := (x->>'end')::time;
    if v_e <= v_s then raise exception '%: la fascia delle % termina prima di iniziare.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if v_prev is not null and v_s < v_prev then raise exception '%: fasce sovrapposte alle %.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if nullif(x->>'max', '') is not null and (x->>'max')::int < 1 then raise exception '%: numero massimo di pazienti non valido.', p_where using hint = 'FA_INPUT'; end if;
    v_prev := v_e;
  end loop;
end $$;

-- =====================================================================
-- FisioAgenda — versione pilota: calendario flessibile.
-- - orari diversi per giorno della settimana nello stesso ciclo (weekday_times)
-- - durata della seduta libera (15–120 minuti, multipli di 5)
-- - variazione dell'orario di un collega per un intervallo di date (con ritorno automatico)
-- - spostamento delle sedute di un ciclo "dal … al …"
-- - schemi di orario riutilizzabili
-- Si può eseguire più volte.
-- =====================================================================
alter table public.cycles add column if not exists weekday_times jsonb not null default '{}'::jsonb;
alter table public.cycles drop constraint if exists cycles_duration_check;
alter table public.cycles add constraint cycles_duration_check check (duration between 15 and 120 and duration % 5 = 0);

create or replace function app.check_slot(p_th uuid, p_day date, p_start time, p_end time,
  p_patient uuid default null, p_ignore uuid default null, p_cycle uuid default null, p_reserve boolean default true)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_th public.therapists;
  v_lab text;
  v_abs public.absences;
  v_blk record;
  v_o record;
  v_n int;
  v_slot tsrange := tsrange(p_day + p_start, p_day + p_end, '[)');
  v_ign uuid := coalesce(p_ignore, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if p_end <= p_start then return 'Orario non valido.'; end if;
  select * into v_th from public.therapists where id = p_th;
  if not found then return 'Fisioterapista inesistente.'; end if;
  if not v_th.active then return v_th.name || ' non è attivo.'; end if;

  select label into v_lab from public.closures where day = p_day;
  if found then return 'Servizio chiuso il ' || app.fmt_d(p_day) || ' (' || v_lab || ').'; end if;

  select * into v_abs from public.absences a
   where a.therapist_id = p_th and not a.cancelled and a.start_date <= p_day
     and (a.end_date is null or a.end_date >= p_day)
     and (a.start_time is null or (a.start_time < p_end and p_start < a.end_time))
   order by a.start_time nulls first limit 1;
  if found then
    return v_th.name || ' è assente'
      || case when v_abs.start_time is null then '' else ' dalle ' || app.fmt_t(v_abs.start_time) || ' alle ' || app.fmt_t(v_abs.end_time) end
      || case when v_abs.end_date is null then ' (rientro non noto)' else '' end || '.';
  end if;

  select * into v_blk from app.day_blocks(p_th, p_day) b where b.kind = 'amb' and b.s <= p_start and b.e >= p_end limit 1;
  if not found then
    if not exists (select 1 from app.day_blocks(p_th, p_day)) then
      return v_th.name || ' non è in servizio il ' || app.fmt_d(p_day) || '.';
    end if;
    select b.kind, b.s, b.e into v_o from app.day_blocks(p_th, p_day) b
     where b.kind <> 'amb' and b.s < p_end and p_start < b.e order by b.s limit 1;
    if found then
      return 'Orario non disponibile: ' || app.block_label(v_o.kind) || ' ' || app.fmt_t(v_o.s) || '–' || app.fmt_t(v_o.e) || ' di ' || v_th.name || '.';
    end if;
    return 'Orario fuori dalle fasce ambulatoriali di ' || v_th.name || '.';
  end if;

  select a.start_time, a.end_time, p.name into v_o
    from public.appointments a join public.patients p on p.id = a.patient_id
   where a.therapist_id = p_th and a.status in ('programmata', 'effettuata', 'trattenuta')
     and a.slot && v_slot and a.id <> v_ign limit 1;
  if found then
    return 'Posto già occupato: ' || v_th.name || ' ha ' || v_o.name || ' ' || app.fmt_t(v_o.start_time) || '–' || app.fmt_t(v_o.end_time) || '.';
  end if;

  if p_patient is not null then
    select a.start_time, a.end_time, t.name into v_o
      from public.appointments a join public.therapists t on t.id = a.therapist_id
     where a.patient_id = p_patient and a.status in ('programmata', 'effettuata', 'trattenuta')
       and a.slot && v_slot and a.id <> v_ign limit 1;
    if found then
      return 'Il paziente ha già un appuntamento ' || app.fmt_t(v_o.start_time) || '–' || app.fmt_t(v_o.end_time) || ' con ' || v_o.name || '.';
    end if;
  end if;

  if v_blk.maxp is not null then
    select count(*) into v_n from public.appointments a
     where a.therapist_id = p_th and a.day = p_day and a.status in ('programmata', 'effettuata', 'trattenuta')
       and a.start_time >= v_blk.s and a.end_time <= v_blk.e and a.id <> v_ign;
    if v_n >= v_blk.maxp then
      return 'La fascia ' || app.fmt_t(v_blk.s) || '–' || app.fmt_t(v_blk.e) || ' di ' || v_th.name || ' accoglie al massimo ' || v_blk.maxp || ' paziente/i.';
    end if;
  end if;

  if v_th.max_daily is not null then
    select count(*) into v_n from public.appointments a
     where a.therapist_id = p_th and a.day = p_day and a.status in ('programmata', 'effettuata', 'trattenuta') and a.id <> v_ign;
    if v_n >= v_th.max_daily then
      return v_th.name || ' ha già ' || v_n || ' pazienti il ' || app.fmt_d(p_day) || ' (limite giornaliero ' || v_th.max_daily || ').';
    end if;
  end if;

  -- posto ricorrente di un ciclo attivo senza conclusione confermata: dopo l'ultima seduta è solo probabile
  if p_reserve then
    select p.name, c.forecast into v_o
      from public.cycles c join public.patients p on p.id = c.patient_id
     where c.therapist_id = p_th and c.status = 'attivo' and c.id is distinct from p_cycle
       and c.forecast <> 'conclusione_confermata' and c.start_time is not null
       and extract(isodow from p_day)::int = any (c.weekdays)
       and coalesce(nullif(c.weekday_times ->> (extract(isodow from p_day)::int)::text, '')::time, c.start_time) < p_end
       and p_start < (coalesce(nullif(c.weekday_times ->> (extract(isodow from p_day)::int)::text, '')::time, c.start_time) + make_interval(mins => c.duration))
       and p_day > coalesce((select max(a.day) from public.appointments a
                              where a.cycle_id = c.id and a.status in ('programmata', 'effettuata', 'trattenuta')), p_day)
     limit 1;
    if found then
      return 'Posto solo probabile: si libera se il ciclo di ' || v_o.name || ' si conclude (previsione: '
        || app.forecast_label(v_o.forecast) || '). Non è una disponibilità certa.';
    end if;
  end if;
  return null;
end $$;

-- Prenotazione con orario per ogni seduta (anche diverso tra i giorni della settimana).
-- p_slots: [{"day":"2026-10-12","start":"08:15"}, ...] — tante quante le sedute da svolgere.
create or replace function public.book_cycle_slots(p_cycle uuid, p_version int, p_therapist uuid, p_slots jsonb, p_weekdays int[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; it jsonb; v_d date; v_s time; v_msg text; v_n int := 0; v_pname text; v_times jsonb := '{}'::jsonb; v_first time;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Richiesta non trovata.'); end if;
  if c.version <> p_version then perform app.stale('La richiesta', c.updated_by); end if;
  if c.status <> 'in_attesa' then perform app.fail('Il ciclo è già stato prenotato.', 'FA_CONFLICT'); end if;
  if coalesce(jsonb_array_length(p_slots), 0) <> c.planned_sessions - c.prior_sessions then
    perform app.fail('Servono ' || (c.planned_sessions - c.prior_sessions) || ' sedute da programmare, ne sono state indicate ' || coalesce(jsonb_array_length(p_slots), 0) || '.');
  end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  select name into v_pname from public.patients where id = c.patient_id;
  for it in select e from jsonb_array_elements(p_slots) e order by (e->>'day')::date loop
    v_d := (it->>'day')::date; v_s := (it->>'start')::time;
    if v_d < app.today() then perform app.fail('La data ' || app.fmt_d(v_d) || ' è già passata.'); end if;
    v_msg := app.check_slot(p_therapist, v_d, v_s, v_s + make_interval(mins => c.duration), c.patient_id, null, c.id, true);
    if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(v_d) || ' alle ' || app.fmt_t(v_s) || ': ' || v_msg, 'FA_SLOT'); end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, v_s, v_s + make_interval(mins => c.duration), auth.uid());
    if v_first is null then v_first := v_s; end if;
    v_times := v_times || jsonb_build_object((extract(isodow from v_d)::int)::text, app.fmt_t(v_s));
    v_n := v_n + 1;
  end loop;
  update public.cycles set status = 'attivo', therapist_id = p_therapist, start_time = v_first, weekday_times = v_times,
    weekdays = coalesce(p_weekdays, weekdays) where id = c.id;
  perform app.log('prenotazione', 'Prenotato il ciclo di ' || v_pname || ' con ' || app.th_name(p_therapist) || ': ' || v_n
    || ' sedute' || case when c.prior_sessions > 0 then ' (già svolte ' || c.prior_sessions || ')' else '' end || ', dal '
    || app.fmt_d((p_slots->0->>'day')::date) || '.', 'cycle', c.id::text, jsonb_build_object('therapist_id', p_therapist, 'slots', p_slots));
  return jsonb_build_object('booked', v_n);
exception when exclusion_violation then
  raise exception 'Un posto è stato appena occupato da un altro utente. Nessuna seduta è stata salvata: riprova.' using hint = 'FA_SLOT';
end $$;

-- Variazione dell'orario delle sedute programmate di un ciclo dal … al … (o fino alla fine):
-- stessi giorni, nuovo orario per giorno della settimana e/o altro fisioterapista. Tutto o niente.
create or replace function public.reschedule_range(p_cycle uuid, p_version int, p_from date, p_to date, p_therapist uuid, p_times jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; a public.appointments; v_s time; v_msg text; v_n int := 0; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if p_from < app.today() then perform app.fail('La data iniziale non può essere passata.'); end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  if c.therapist_id is not null then perform app.lock_th(c.therapist_id); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  for a in select * from public.appointments where cycle_id = c.id and status = 'programmata' and day >= p_from
             and (p_to is null or day <= p_to) order by day, start_time loop
    v_s := coalesce(nullif(p_times ->> (extract(isodow from a.day)::int)::text, '')::time, a.start_time);
    v_msg := app.check_slot(p_therapist, a.day, v_s, v_s + (a.end_time - a.start_time), a.patient_id, a.id, a.cycle_id, true);
    if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(a.day) || ': ' || v_msg, 'FA_SLOT'); end if;
    update public.appointments set therapist_id = p_therapist, start_time = v_s, end_time = v_s + (a.end_time - a.start_time),
      substitute_kind = case when p_therapist = c.therapist_id then substitute_kind else coalesce(substitute_kind, 'periodo') end,
      original_therapist_id = case when p_therapist = c.therapist_id then original_therapist_id else coalesce(original_therapist_id, a.therapist_id) end,
      note = coalesce(nullif(p_note, ''), note)
    where id = a.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then perform app.fail('Nessuna seduta programmata nell''intervallo scelto.'); end if;
  if p_to is null then
    update public.cycles set therapist_id = p_therapist, weekday_times = weekday_times || coalesce(p_times, '{}'::jsonb) where id = c.id;
  end if;
  perform app.log('modifica_ciclo', v_pname || ': ' || v_n || ' sedute ' || case when p_to is null then 'dal ' || app.fmt_d(p_from) || ' in poi'
    else 'dal ' || app.fmt_d(p_from) || ' al ' || app.fmt_d(p_to) end || ' con ' || app.th_name(p_therapist) || ', nuovo orario.', 'cycle', c.id::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'therapist_id', p_therapist, 'times', p_times));
  return jsonb_build_object('moved', v_n);
exception when exclusion_violation then
  raise exception 'Un posto è stato appena occupato da un altro utente. Nessuna modifica salvata.' using hint = 'FA_SLOT';
end $$;

-- Orario di un collega per un intervallo di date: dal giorno p_from vale p_week;
-- dal giorno dopo p_to torna l'orario che c'era prima. Lo storico resta.
create or replace function public.admin_save_shift_range(p_th uuid, p_from date, p_to date, p_week jsonb, p_note text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_conf jsonb; d int; v_mid date;
begin
  perform app.require_role('admin');
  if p_to < p_from then perform app.fail('La data finale precede quella iniziale.'); end if;
  if p_from < app.today() then perform app.fail('La data iniziale non può essere nel passato.'); end if;
  for d in 1..7 loop
    perform app.validate_blocks(coalesce(p_week -> d::text, '[]'::jsonb), 'Orario, ' || (array['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'])[d]);
  end loop;
  select min(valid_from) into v_mid from public.shift_versions where therapist_id = p_th and valid_from > p_from and valid_from <= p_to;
  if v_mid is not null then
    perform app.fail('Nell''intervallo c''è già un cambio di orario dal ' || app.fmt_d(v_mid) || ': scegli un intervallo che finisce prima.');
  end if;
  select week into v_prev from public.shift_versions where therapist_id = p_th and valid_from <= p_to + 1 order by valid_from desc limit 1;
  begin
    insert into public.shift_versions (therapist_id, valid_from, week, note, created_by)
    values (p_th, p_from, p_week, coalesce(p_note, ''), auth.uid())
    on conflict (therapist_id, valid_from) do update set week = excluded.week, note = excluded.note, created_by = excluded.created_by, created_at = now();
    if not exists (select 1 from public.shift_versions where therapist_id = p_th and valid_from = p_to + 1) then
      insert into public.shift_versions (therapist_id, valid_from, week, note, created_by)
      values (p_th, p_to + 1, coalesce(v_prev, '{"1":[],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[]}'::jsonb), 'Ritorno all''orario precedente', auth.uid());
    end if;
    v_conf := app.th_conflicts(p_th, p_from, p_to);
    if p_dry_run then raise exception using errcode = 'P0099', message = 'anteprima'; end if;
  exception when sqlstate 'P0099' then
    return jsonb_build_object('dry_run', true, 'conflicts', v_conf);
  end;
  perform app.log('turno', 'Orario di ' || app.th_name(p_th) || ' variato dal ' || app.fmt_d(p_from) || ' al ' || app.fmt_d(p_to)
    || ' (poi torna il precedente). ' || jsonb_array_length(v_conf) || ' appuntamenti non compatibili, segnalati da sistemare.', 'therapist', p_th::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'week', p_week, 'conflicts', v_conf));
  return jsonb_build_object('dry_run', false, 'conflicts', v_conf);
end $$;

-- Schemi di orario riutilizzabili
create table if not exists public.shift_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  week       jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.shift_templates enable row level security;
drop policy if exists lettura on public.shift_templates;
create policy lettura on public.shift_templates for select to authenticated using (app.is_reader());
revoke all on public.shift_templates from anon;
revoke insert, update, delete, truncate on public.shift_templates from authenticated;
grant select on public.shift_templates to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shift_templates') then
    alter publication supabase_realtime add table public.shift_templates;
  end if;
end $$;

create or replace function public.admin_save_template(p_id uuid, p_name text, p_week jsonb, p_delete boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; d int;
begin
  perform app.require_role('admin');
  if p_delete then
    delete from public.shift_templates where id = p_id;
    perform app.log('configurazione', 'Schema di orario eliminato.', 'template', p_id::text, null);
    return p_id;
  end if;
  for d in 1..7 loop perform app.validate_blocks(coalesce(p_week -> d::text, '[]'::jsonb), 'Schema'); end loop;
  if v_id is null then
    insert into public.shift_templates (name, week, created_by) values (trim(p_name), p_week, auth.uid()) returning id into v_id;
  else
    update public.shift_templates set name = trim(p_name), week = p_week where id = v_id;
  end if;
  perform app.log('configurazione', 'Schema di orario «' || trim(p_name) || '» salvato.', 'template', v_id::text, null);
  return v_id;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('book_cycle_slots', 'reschedule_range', 'admin_save_shift_range', 'admin_save_template') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- =====================================================================
-- FisioAgenda — versione pilota: importazione dei tabulati cartacei e
-- correzioni rapide dal calendario del fisioterapista.
-- - importazioni (import_batches): chi, quando, quale foglio; annullabili
-- - numero scritto sul tabulato (a ritroso: 10 = prima seduta) e "R" (recupero) su ogni seduta importata
-- - visite fisiatriche ("V") come eventi del paziente: non sono sedute e non occupano il calendario
-- - tipo di trattamento del ciclo (GC = seduta semplice, RM = rieducazione motoria, …)
-- - correzioni rapide: elimina una seduta inserita per errore, numerazione/durata/tipo del ciclo,
--   sedute aggiunte a un ciclo in corso, spostamento anche di sedute passate (correzione)
-- Si può eseguire più volte.
-- =====================================================================

create table if not exists public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  number       bigint generated by default as identity,
  therapist_id uuid not null references public.therapists(id),
  month        date not null,
  from_date    date not null,
  photo_hash   text,
  source_hash  text not null default '',
  label        text not null default '',
  summary      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  undone_at    timestamptz,
  undone_by    uuid,
  undo_summary jsonb
);
create index if not exists import_batches_th_idx on public.import_batches (therapist_id, month);

create table if not exists public.patient_events (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  day             date not null,
  kind            text not null default 'visita_fisiatrica' check (kind in ('visita_fisiatrica')),
  note            text not null default '',
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (patient_id, day, kind)
);

alter table public.patients add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.cycles add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.cycles add column if not exists treatment text not null default '';
alter table public.appointments add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.appointments add column if not exists sheet_number int;
alter table public.appointments add column if not exists sheet_mark text;
do $$ begin
  alter table public.appointments add constraint appointments_sheet_check
    check ((sheet_number is null or sheet_number between 1 and 30) and (sheet_mark is null or sheet_mark in ('R')));
exception when duplicate_object then null; end $$;
create index if not exists appointments_batch_idx on public.appointments (import_batch_id) where import_batch_id is not null;
create index if not exists appointments_pat_day_idx on public.appointments (patient_id, day);

-- lettura per gli utenti attivi, nessuna scrittura diretta, tempo reale, registro tecnico
do $$
declare t text;
begin
  foreach t in array array['import_batches', 'patient_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lettura on public.%I', t);
    execute format('create policy lettura on public.%I for select to authenticated using (app.is_reader())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists track on public.%I', t);
    execute format('create trigger track after insert or update or delete on public.%I for each row execute function app.track_row()', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.patient_events replica identity full;

-- nome confrontabile: minuscole, senza accenti né punteggiatura
create or replace function app.norm_name(p text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(p, ''), 'àáâäèéêëìíîïòóôöùúûüÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ', 'aaaaeeeeiiiioooouuuuaaaaeeeeiiiioooouuuu')),
                              '[^a-z0-9]+', ' ', 'g'))
$$;

-- Inserisce le sedute di una riga in un ciclo; salta quelle già presenti. Restituisce [inserite, doppioni, fuori turno].
-- Una casella con "therapist_id" (sigla di un collega sotto il numero) è una sostituzione: va nel calendario del collega.
drop function if exists app.import_cells(uuid, uuid, uuid, uuid, text, int, time, jsonb);
create or replace function app.import_cells(p_batch uuid, p_th uuid, p_cyc uuid, p_pat uuid, p_name text, p_dur int, p_start time, p_cells jsonb, p_cat text)
returns int[] language plpgsql security definer set search_path = '' as $$
declare cell jsonb; v_day date; v_start time; v_msg text; v_mark text; v_n int := 0; v_d int := 0; v_f int := 0; v_th uuid;
begin
  for cell in select e from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) e order by (e->>'day')::date loop
    v_day := (cell->>'day')::date;
    v_start := coalesce(nullif(cell->>'start', '')::time, p_start);
    if v_start is null then perform app.fail(p_name || ': manca l''orario della seduta del ' || app.fmt_d(v_day) || '.'); end if;
    v_mark := nullif(cell->>'mark', '');
    v_th := coalesce(nullif(cell->>'therapist_id', '')::uuid, p_th);
    if exists (select 1 from public.appointments a where a.patient_id = p_pat and a.day = v_day and a.status not in ('spostata', 'liberata')) then
      v_d := v_d + 1; continue;
    end if;
    if v_th <> p_th then perform app.require_skill(v_th, p_cat); perform app.lock_th(v_th); end if;
    v_msg := app.check_slot(v_th, v_day, v_start, v_start + make_interval(mins => p_dur), p_pat, null, p_cyc, false);
    if v_msg is not null then
      if not coalesce((cell->>'force')::boolean, false) then
        perform app.fail(p_name || ', ' || app.fmt_d(v_day) || ' ' || app.fmt_t(v_start) || ': ' || v_msg, 'FA_SLOT');
      end if;
      v_f := v_f + 1;
    end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, sheet_number, sheet_mark, import_batch_id, note,
      substitute_kind, original_therapist_id, created_by)
    values (p_cyc, p_pat, v_th, v_day, v_start, v_start + make_interval(mins => p_dur), nullif(cell->>'number', '')::int, v_mark, p_batch,
      case when v_mark = 'R' then 'Recupero (dal tabulato)' else '' end,
      case when v_th <> p_th then 'singola' end, case when v_th <> p_th then p_th end, auth.uid());
    v_n := v_n + 1;
  end loop;
  return array[v_n, v_d, v_f];
end $$;

-- ---------------------------------------------------------------------
-- Importazione di un tabulato (tutto o niente).
-- p = { therapist_id, month: 'YYYY-MM-01', from_date, photo_hash, source_hash, label,
--       rows: [{ ref, target: 'nuovo'|'paziente'|'ciclo', patient_name, patient_id, cycle_id, homonym,
--                category_id, treatment, planned, prior, duration, weekdays: [1,3,5], start,
--                cells: [{ day, start, number, mark, force }], visits: ['YYYY-MM-DD', …],
--                next: { planned, prior, cells }, concluded }],   -- concluded = "//" dopo il nome: fine ciclo     -- nuovo ciclo dello stesso paziente sulla stessa riga
--       extra: [{ cycle_id, day, start, number, force }] }      -- pazienti di colleghi trattati in sostituzione
-- Le caselle già presenti (stesso paziente, stesso giorno) vengono saltate: ricaricare lo
-- stesso tabulato non crea doppioni. Le date passate restano "programmate": il tabulato
-- non dimostra la presenza, l'esito si registra a parte.
-- ---------------------------------------------------------------------
create or replace function public.import_sheet(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_th uuid := nullif(p->>'therapist_id', '')::uuid;
  v_batch uuid; v_bno bigint;
  r jsonb; cell jsonb; v_pat uuid; v_cyc uuid; c public.cycles;
  v_name text; v_dur int; v_start time; v_day date; v_msg text; v_wd int[]; v_times jsonb;
  v_new_pat int := 0; v_new_cyc int := 0; v_appts int := 0; v_dups int := 0; v_visits int := 0; v_forced int := 0;
  v_rows int := 0; v_planned int; v_prior int; v_ref text; v_res int[];
begin
  perform app.require_role('operatore');
  if v_th is null or not exists (select 1 from public.therapists where id = v_th) then perform app.fail('Scegli il fisioterapista del tabulato.'); end if;
  if nullif(p->>'month', '') is null then perform app.fail('Indica mese e anno del tabulato.'); end if;
  if nullif(p->>'from_date', '') is null then perform app.fail('Indica la data da cui importare.'); end if;
  perform app.lock_th(v_th);
  insert into public.import_batches (therapist_id, month, from_date, photo_hash, source_hash, label, created_by)
  values (v_th, (p->>'month')::date, (p->>'from_date')::date, nullif(p->>'photo_hash', ''), coalesce(p->>'source_hash', ''),
          coalesce(p->>'label', ''), auth.uid())
  returning id, number into v_batch, v_bno;

  for r in select e from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) e loop
    v_ref := coalesce(r->>'ref', '');
    v_name := trim(coalesce(r->>'patient_name', ''));
    v_dur := coalesce(nullif(r->>'duration', '')::int, 0);
    v_cyc := null; v_pat := null;
    -- paziente e ciclo
    if r->>'target' = 'ciclo' then
      select * into c from public.cycles where id = nullif(r->>'cycle_id', '')::uuid for update;
      if not found then perform app.fail('Riga ' || v_ref || ': ciclo non trovato.'); end if;
      if c.status <> 'attivo' then perform app.fail('Riga ' || v_ref || ': il ciclo scelto non è attivo.'); end if;
      v_cyc := c.id; v_pat := c.patient_id; v_dur := c.duration;
      select name into v_name from public.patients where id = v_pat;
    else
      if r->>'target' = 'paziente' then
        v_pat := nullif(r->>'patient_id', '')::uuid;
        select name into v_name from public.patients where id = v_pat;
        if not found then perform app.fail('Riga ' || v_ref || ': paziente non trovato.'); end if;
      elsif r->>'target' = 'nuovo' then
        if v_name = '' then perform app.fail('Riga ' || v_ref || ': manca il nome del paziente.'); end if;
        if not coalesce((r->>'homonym')::boolean, false)
           and exists (select 1 from public.patients x where app.norm_name(x.name) = app.norm_name(v_name)) then
          perform app.fail('Riga ' || v_ref || ': esiste già un paziente «' || v_name || '». Scegli se è lo stesso o un omonimo.', 'FA_CONFLICT');
        end if;
        insert into public.patients (name, import_batch_id) values (v_name, v_batch) returning id into v_pat;
        v_new_pat := v_new_pat + 1;
      else
        perform app.fail('Riga ' || v_ref || ': indica se il paziente è nuovo o già presente.');
      end if;
      if not exists (select 1 from public.categories where id = r->>'category_id') then perform app.fail('Riga ' || v_ref || ': scegli il percorso.'); end if;
      perform app.require_skill(v_th, r->>'category_id');
      if v_dur < 15 or v_dur > 120 or v_dur % 5 <> 0 then perform app.fail('Riga ' || v_ref || ': durata della seduta non valida.'); end if;
      v_planned := coalesce(nullif(r->>'planned', '')::int, 10);
      v_prior := coalesce(nullif(r->>'prior', '')::int, 0);
      if v_prior < 0 or v_prior >= v_planned then perform app.fail('Riga ' || v_ref || ': sedute precedenti non coerenti con il ciclo (' || v_prior || ' su ' || v_planned || ').'); end if;
      v_wd := coalesce((select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(r->'weekdays') x), '{}');
      v_start := nullif(r->>'start', '')::time;
      v_times := coalesce((select jsonb_object_agg(w::text, app.fmt_t(v_start)) from unnest(v_wd) w where v_start is not null), '{}'::jsonb);
      insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays,
        weekday_times, start_time, therapist_id, status, treatment, note, import_batch_id, created_by)
      values (v_pat, r->>'category_id', 'NI', case when v_prior > 0 then 'continuazione' else 'prima' end, v_dur, v_planned, v_prior, v_wd,
        v_times, v_start, v_th, 'attivo', coalesce(r->>'treatment', ''), 'Importato dal tabulato (importazione n. ' || v_bno || ').', v_batch, auth.uid())
      returning id into v_cyc;
      v_new_cyc := v_new_cyc + 1;
    end if;
    v_rows := v_rows + 1;
    -- sedute
    v_res := app.import_cells(v_batch, v_th, v_cyc, v_pat, v_name, v_dur, nullif(r->>'start', '')::time, r->'cells', (select category_id from public.cycles where id = v_cyc));
    v_appts := v_appts + v_res[1]; v_dups := v_dups + v_res[2]; v_forced := v_forced + v_res[3];
    -- "//" dopo il nome: fine ciclo (vale per l'ultimo ciclo della riga)
    if coalesce((r->>'concluded')::boolean, false) and jsonb_array_length(coalesce(r->'next'->'cells', '[]'::jsonb)) = 0 then
      update public.cycles set forecast = 'conclusione_confermata' where id = v_cyc;
    end if;
    -- nuovo ciclo dello stesso paziente iniziato sulla stessa riga (dopo il n. 1 si ricomincia da capo)
    if jsonb_array_length(coalesce(r->'next'->'cells', '[]'::jsonb)) > 0 then
      select * into c from public.cycles where id = v_cyc;
      v_planned := coalesce(nullif(r->'next'->>'planned', '')::int, c.planned_sessions);
      v_prior := coalesce(nullif(r->'next'->>'prior', '')::int, 0);
      if v_prior < 0 or v_prior >= v_planned then perform app.fail('Riga ' || v_ref || ': numerazione del nuovo ciclo non coerente.'); end if;
      insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays,
        weekday_times, start_time, therapist_id, status, treatment, note, import_batch_id, created_by)
      values (v_pat, c.category_id, 'NI', 'continuazione', c.duration, v_planned, v_prior, c.weekdays, c.weekday_times, c.start_time, v_th, 'attivo',
        c.treatment, 'Nuovo ciclo importato dal tabulato (importazione n. ' || v_bno || ').', v_batch, auth.uid())
      returning id into v_cyc;
      v_new_cyc := v_new_cyc + 1;
      v_res := app.import_cells(v_batch, v_th, v_cyc, v_pat, v_name, c.duration, nullif(r->>'start', '')::time, r->'next'->'cells', c.category_id);
      v_appts := v_appts + v_res[1]; v_dups := v_dups + v_res[2]; v_forced := v_forced + v_res[3];
      if coalesce((r->>'concluded')::boolean, false) then update public.cycles set forecast = 'conclusione_confermata' where id = v_cyc; end if;
    end if;
    -- visite fisiatriche: eventi del paziente, non sedute
    for cell in select e from jsonb_array_elements(coalesce(r->'visits', '[]'::jsonb)) e loop
      insert into public.patient_events (patient_id, day, kind, import_batch_id, created_by)
      values (v_pat, (cell #>> '{}')::date, 'visita_fisiatrica', v_batch, auth.uid())
      on conflict (patient_id, day, kind) do nothing;
      if found then v_visits := v_visits + 1; end if;
    end loop;
  end loop;

  -- sedute di pazienti di colleghi trattati in sostituzione (stesso ciclo, altro fisioterapista)
  for cell in select e from jsonb_array_elements(coalesce(p->'extra', '[]'::jsonb)) e loop
    select * into c from public.cycles where id = nullif(cell->>'cycle_id', '')::uuid;
    if not found or c.status <> 'attivo' then perform app.fail('Sostituzione: ciclo del paziente non trovato o non attivo.'); end if;
    perform app.require_skill(v_th, c.category_id);
    select name into v_name from public.patients where id = c.patient_id;
    v_day := (cell->>'day')::date; v_start := (cell->>'start')::time;
    if exists (select 1 from public.appointments a where a.patient_id = c.patient_id and a.day = v_day and a.status not in ('spostata', 'liberata')) then
      v_dups := v_dups + 1; continue;
    end if;
    v_msg := app.check_slot(v_th, v_day, v_start, v_start + make_interval(mins => c.duration), c.patient_id, null, c.id, false);
    if v_msg is not null then
      if not coalesce((cell->>'force')::boolean, false) then perform app.fail(v_name || ', ' || app.fmt_d(v_day) || ': ' || v_msg, 'FA_SLOT'); end if;
      v_forced := v_forced + 1;
    end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, sheet_number, import_batch_id,
      substitute_kind, original_therapist_id, created_by)
    values (c.id, c.patient_id, v_th, v_day, v_start, v_start + make_interval(mins => c.duration), nullif(cell->>'number', '')::int, v_batch,
      case when c.therapist_id is distinct from v_th then 'singola' end, case when c.therapist_id is distinct from v_th then c.therapist_id end, auth.uid());
    v_appts := v_appts + 1;
  end loop;

  update public.import_batches set summary = jsonb_build_object('rows', v_rows, 'patients', v_new_pat, 'cycles', v_new_cyc,
    'appointments', v_appts, 'duplicates', v_dups, 'visits', v_visits, 'forced', v_forced) where id = v_batch;
  perform app.log('importazione', 'Importazione n. ' || v_bno || ' dal tabulato di ' || app.th_name(v_th) || ' ('
    || to_char((p->>'month')::date, 'MM/YYYY') || '): ' || v_rows || ' pazienti, ' || v_appts || ' sedute'
    || case when v_dups > 0 then ', ' || v_dups || ' già presenti saltate' else '' end
    || case when v_visits > 0 then ', ' || v_visits || ' visite fisiatriche' else '' end
    || case when v_forced > 0 then ', ' || v_forced || ' fuori turno da sistemare' else '' end || '.',
    'import', v_batch::text, jsonb_build_object('label', p->>'label', 'from_date', p->>'from_date'));
  return jsonb_build_object('batch_id', v_batch, 'number', v_bno, 'rows', v_rows, 'patients', v_new_pat, 'cycles', v_new_cyc,
    'appointments', v_appts, 'duplicates', v_dups, 'visits', v_visits, 'forced', v_forced);
exception when exclusion_violation then
  raise exception 'Due sedute si sovrappongono (stesso fisioterapista o stesso paziente alla stessa ora). Nulla è stato importato: controlla l''anteprima.' using hint = 'FA_SLOT';
end $$;

-- Annulla un'importazione: elimina ciò che ha creato e che nessuno ha ancora usato.
-- Le sedute con un esito già registrato (effettuata, assenza, …) restano e vengono segnalate.
create or replace function public.undo_import(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.import_batches; v_appts int; v_kept int; v_cycles int; v_pats int; v_visits int; v_sum jsonb;
begin
  perform app.require_role('operatore');
  select * into b from public.import_batches where id = p_batch for update;
  if not found then perform app.fail('Importazione non trovata.'); end if;
  if b.undone_at is not null then perform app.fail('Questa importazione è già stata annullata.', 'FA_CONFLICT'); end if;
  perform app.lock_th(b.therapist_id);
  with d as (delete from public.appointments a where a.import_batch_id = b.id and a.status in ('programmata', 'da_riprogrammare')
               and a.recovered_by is null and not exists (select 1 from public.appointments x where x.recovery_of = a.id) returning 1)
  select count(*) into v_appts from d;
  select count(*) into v_kept from public.appointments where import_batch_id = b.id;
  with d as (delete from public.patient_events where import_batch_id = b.id returning 1) select count(*) into v_visits from d;
  with d as (delete from public.cycles c where c.import_batch_id = b.id
               and not exists (select 1 from public.appointments a where a.cycle_id = c.id) returning 1)
  select count(*) into v_cycles from d;
  with d as (delete from public.patients x where x.import_batch_id = b.id
               and not exists (select 1 from public.cycles c where c.patient_id = x.id)
               and not exists (select 1 from public.appointments a where a.patient_id = x.id) returning 1)
  select count(*) into v_pats from d;
  v_sum := jsonb_build_object('appointments', v_appts, 'kept', v_kept, 'cycles', v_cycles, 'patients', v_pats, 'visits', v_visits);
  update public.import_batches set undone_at = now(), undone_by = auth.uid(), undo_summary = v_sum where id = b.id;
  perform app.log('importazione', 'Importazione n. ' || b.number || ' (' || app.th_name(b.therapist_id) || ') annullata: '
    || v_appts || ' sedute eliminate' || case when v_kept > 0 then ', ' || v_kept || ' con esito già registrato mantenute' else '' end || '.',
    'import', b.id::text, v_sum);
  return v_sum;
end $$;

-- ---------------------------------------------------------------------
-- Correzioni rapide dal calendario
-- ---------------------------------------------------------------------
-- Elimina una seduta inserita per errore (solo se ancora programmata). Lo storico la conserva.
create or replace function public.delete_appointment(p_id uuid, p_version int, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_pname text;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_id for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if a.status not in ('programmata', 'da_riprogrammare') then
    perform app.fail('Si possono eliminare solo sedute ancora programmate: per le altre correggi l''esito.');
  end if;
  if exists (select 1 from public.appointments x where x.recovery_of = a.id) then
    perform app.fail('Per questa seduta è programmato un recupero: elimina prima il recupero.');
  end if;
  delete from public.appointments where id = a.id;
  perform app.log('eliminazione', v_pname || ': seduta del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ' con '
    || app.th_name(a.therapist_id) || ' eliminata' || case when coalesce(p_note, '') <> '' then ' (' || p_note || ')' else '' end || '.',
    'appointment', a.id::text, to_jsonb(a) - 'slot');
end $$;

-- Numerazione, sedute previste, durata (sedute future), tipo e percorso di un ciclo attivo
create or replace function public.quick_edit_cycle(p_cycle uuid, p_version int, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_dur int; v_msg text; x record; v_n int := 0; v_pname text; v_used int;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  if p ? 'category_id' and p->>'category_id' <> c.category_id then
    if not exists (select 1 from public.categories where id = p->>'category_id') then perform app.fail('Percorso non valido.'); end if;
    if c.therapist_id is not null then perform app.require_skill(c.therapist_id, p->>'category_id'); end if;
  end if;
  update public.cycles set
    prior_sessions = coalesce(nullif(p->>'prior_sessions', '')::int, prior_sessions),
    planned_sessions = coalesce(nullif(p->>'planned_sessions', '')::int, planned_sessions),
    treatment = coalesce(p->>'treatment', treatment),
    category_id = coalesce(nullif(p->>'category_id', ''), category_id)
  where id = c.id;
  v_dur := nullif(p->>'duration', '')::int;
  if v_dur is not null and v_dur <> c.duration then
    if v_dur < 15 or v_dur > 120 or v_dur % 5 <> 0 then perform app.fail('Durata non valida (da 15 a 120 minuti, multipli di 5).'); end if;
    if c.therapist_id is not null then perform app.lock_th(c.therapist_id); end if;
    for x in select * from public.appointments where cycle_id = c.id and status = 'programmata' and day >= app.today() order by day loop
      v_msg := app.check_slot(x.therapist_id, x.day, x.start_time, x.start_time + make_interval(mins => v_dur), x.patient_id, x.id, c.id, false);
      if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(x.day) || ': ' || v_msg, 'FA_SLOT'); end if;
      update public.appointments set end_time = x.start_time + make_interval(mins => v_dur) where id = x.id;
      v_n := v_n + 1;
    end loop;
    update public.cycles set duration = v_dur where id = c.id;
  end if;
  select count(*) into v_used from public.appointments a where a.cycle_id = c.id and a.recovery_of is null and a.sheet_mark is null
     and a.status in ('programmata', 'effettuata', 'trattenuta', 'da_riprogrammare');
  perform app.log('ciclo', 'Ciclo di ' || v_pname || ' corretto dal calendario' || case when v_n > 0 then ' (' || v_n || ' sedute con nuova durata)' else '' end || '.',
    'cycle', c.id::text, p);
  return jsonb_build_object('resized', v_n, 'used', v_used);
exception
  when check_violation then raise exception 'Numerazione non coerente: le sedute precedenti devono essere meno di quelle previste.' using hint = 'FA_INPUT';
  when exclusion_violation then raise exception 'Con la nuova durata una seduta si sovrappone a un altro appuntamento.' using hint = 'FA_SLOT';
end $$;

-- Aggiunge sedute a un ciclo già attivo (es. una seduta dimenticata), entro il numero previsto
create or replace function public.add_cycle_slots(p_cycle uuid, p_version int, p_therapist uuid, p_slots jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; it jsonb; v_d date; v_s time; v_msg text; v_n int := 0; v_used int; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status <> 'attivo' then perform app.fail('Si possono aggiungere sedute solo a un ciclo attivo.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  select count(*) into v_used from public.appointments a where a.cycle_id = c.id and a.recovery_of is null and a.sheet_mark is null
     and a.status in ('programmata', 'effettuata', 'trattenuta', 'da_riprogrammare');
  if c.prior_sessions + v_used + coalesce(jsonb_array_length(p_slots), 0) > c.planned_sessions then
    perform app.fail('Il ciclo di ' || v_pname || ' ha già ' || (c.prior_sessions + v_used) || ' sedute su ' || c.planned_sessions
      || ': aumenta le sedute previste o correggi la numerazione.');
  end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  for it in select e from jsonb_array_elements(p_slots) e order by (e->>'day')::date loop
    v_d := (it->>'day')::date; v_s := (it->>'start')::time;
    v_msg := app.check_slot(p_therapist, v_d, v_s, v_s + make_interval(mins => c.duration), c.patient_id, null, c.id, false);
    if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(v_d) || ' alle ' || app.fmt_t(v_s) || ': ' || v_msg, 'FA_SLOT'); end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, substitute_kind, original_therapist_id, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, v_s, v_s + make_interval(mins => c.duration),
      case when c.therapist_id is distinct from p_therapist then 'singola' end, case when c.therapist_id is distinct from p_therapist then c.therapist_id end, auth.uid());
    v_n := v_n + 1;
  end loop;
  perform app.log('prenotazione', v_pname || ': ' || v_n || ' sedute aggiunte al ciclo con ' || app.th_name(p_therapist) || '.', 'cycle', c.id::text, p_slots);
  return jsonb_build_object('added', v_n);
exception when exclusion_violation then
  raise exception 'Un posto è stato appena occupato da un altro utente. Nessuna seduta è stata salvata: riprova.' using hint = 'FA_SLOT';
end $$;

-- Visita fisiatrica del paziente in un giorno (non è una seduta)
create or replace function public.save_patient_event(p_patient uuid, p_day date, p_note text default '', p_delete boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pname text;
begin
  perform app.require_role('operatore');
  select name into v_pname from public.patients where id = p_patient;
  if not found then perform app.fail('Paziente non trovato.'); end if;
  if p_delete then
    delete from public.patient_events where patient_id = p_patient and day = p_day and kind = 'visita_fisiatrica';
    perform app.log('visita', v_pname || ': visita fisiatrica del ' || app.fmt_d(p_day) || ' tolta.', 'patient', p_patient::text, null);
  else
    insert into public.patient_events (patient_id, day, kind, note, created_by) values (p_patient, p_day, 'visita_fisiatrica', coalesce(p_note, ''), auth.uid())
    on conflict (patient_id, day, kind) do update set note = excluded.note;
    perform app.log('visita', v_pname || ': visita fisiatrica il ' || app.fmt_d(p_day) || '.', 'patient', p_patient::text, null);
  end if;
end $$;

-- Spostamento di una seduta: ammesso anche nel passato quando si corregge una seduta passata
-- (es. importata nel giorno sbagliato). Le sedute future non si spostano nel passato.
create or replace function public.move_appointment(p_id uuid, p_version int, p_therapist uuid, p_day date, p_start time, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appointments; c public.cycles; v_end time; v_msg text; v_pname text;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_id for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if a.status not in ('programmata', 'da_riprogrammare') then
    perform app.fail('Si possono spostare solo sedute programmate o da riprogrammare.');
  end if;
  if p_day < app.today() and a.day >= app.today() then perform app.fail('Non si può spostare una seduta in una data passata.'); end if;
  select * into c from public.cycles where id = a.cycle_id;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  v_end := p_start + (a.end_time - a.start_time);
  v_msg := app.check_slot(p_therapist, p_day, p_start, v_end, a.patient_id, a.id, a.cycle_id, true);
  if v_msg is not null then perform app.fail(v_msg, 'FA_SLOT'); end if;
  update public.appointments set therapist_id = p_therapist, day = p_day, start_time = p_start, end_time = v_end,
    status = 'programmata', reason = '', note = coalesce(nullif(p_note, ''), note),
    substitute_kind = case when p_therapist = c.therapist_id then null else 'singola' end,
    original_therapist_id = case when p_therapist = c.therapist_id then null else coalesce(a.original_therapist_id, a.therapist_id) end
  where id = a.id;
  perform app.log('spostamento', v_pname || ': seduta del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ' con '
    || app.th_name(a.therapist_id) || ' spostata al ' || app.fmt_d(p_day) || ' ' || app.fmt_t(p_start) || ' con ' || app.th_name(p_therapist)
    || '. Il resto del ciclo non cambia.', 'appointment', a.id::text,
    jsonb_build_object('from', jsonb_build_object('therapist_id', a.therapist_id, 'day', a.day, 'start', a.start_time),
                       'to', jsonb_build_object('therapist_id', p_therapist, 'day', p_day, 'start', p_start)));
exception when exclusion_violation then
  raise exception 'Il posto è stato appena occupato da un altro utente.' using hint = 'FA_SLOT';
end $$;

-- Backup e ripristino comprendono importazioni e visite (i backup precedenti restano validi)
create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := jsonb_build_object('format', 'fisioagenda-pilota', 'format_version', 2, 'exported_at', now(),
  'exported_by', app.my_name());
  t text; v jsonb;
begin
  perform app.require_role('admin');
  foreach t in array array['categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides', 'closures',
                           'absences', 'import_batches', 'patients', 'cycles', 'appointments', 'patient_events', 'audit_log'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''slot''), ''[]''::jsonb) from public.%I x', t) into v;
    r := r || jsonb_build_object(t, v);
  end loop;
  return r;
end $$;

create or replace function public.admin_restore(p jsonb, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text; v_cols text; v_n int; v_counts jsonb := '{}'::jsonb;
begin
  perform app.require_role('admin');
  if p_confirm is distinct from 'RIPRISTINA' then perform app.fail('Conferma mancante: scrivi RIPRISTINA.'); end if;
  if p->>'format' is distinct from 'fisioagenda-pilota' then perform app.fail('Il file non è un backup di FisioAgenda pilota.'); end if;
  perform set_config('app.restoring', 'on', true);
  delete from public.patient_events where true;
  delete from public.appointments where true; delete from public.cycles where true; delete from public.patients where true;
  delete from public.import_batches where true;
  delete from public.absences where true; delete from public.day_overrides where true; delete from public.shift_versions where true;
  delete from public.therapist_skills where true; delete from public.therapists where true; delete from public.closures where true;
  delete from public.categories where true;
  foreach t in array array['categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides', 'closures',
                           'absences', 'import_batches', 'patients', 'cycles', 'appointments', 'patient_events'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', t, v_cols, v_cols, t)
      using coalesce(p->t, '[]'::jsonb);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;
  perform setval(pg_get_serial_sequence('public.import_batches', 'number'), coalesce((select max(number) from public.import_batches), 0) + 1, false);
  perform set_config('app.restoring', 'off', true);
  perform app.log('ripristino', 'Dati ripristinati dal backup del ' || coalesce(p->>'exported_at', '?') || '.', null, null, v_counts);
  return v_counts;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('import_sheet', 'undo_import', 'delete_appointment', 'quick_edit_cycle',
              'add_cycle_slots', 'save_patient_event', 'move_appointment', 'admin_export', 'admin_restore') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.norm_name(text) from public, anon;
revoke all on function app.import_cells(uuid, uuid, uuid, uuid, text, int, time, jsonb, text) from public, anon;

-- =====================================================================
-- FisioAgenda — versione pilota: importazione meno rigida, durata per singola
-- seduta, sostituzioni gestibili, avvisi organizzativi confermabili.
-- - importazione: ogni riga si salva per conto suo; una riga (o una seduta)
--   con un problema non blocca le altre e torna indietro con il motivo preciso
-- - durata 30/45/60 (o altro) per ogni seduta: la durata del ciclo è solo
--   quella proposta, nessun vincolo di durata unica
-- - sostituzioni dal tabulato: anche di pazienti non ancora in archivio
-- - conflitti veri (sovrapposizioni) bloccano; gli avvisi organizzativi
--   (fuori orario, assenza, chiusura, massimo pazienti…) si possono confermare
-- Si può eseguire più volte.
-- =====================================================================

-- Numero di sedute del ciclo libero (non solo 5/10/20/30): un ciclo si può allungare o accorciare.
alter table public.cycles drop constraint if exists cycles_planned_sessions_check;
alter table public.cycles add constraint cycles_planned_sessions_check check (planned_sessions between 1 and 60);

-- Conflitto "vero": la seduta si sovrappone a un'altra dello stesso fisioterapista o dello stesso paziente.
create or replace function app.hard_conflict(p_th uuid, p_day date, p_start time, p_end time, p_patient uuid default null, p_ignore uuid default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_o record; v_slot tsrange; v_ign uuid := coalesce(p_ignore, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if p_end <= p_start then return 'Orario non valido (la fine è prima dell''inizio).'; end if;
  v_slot := tsrange(p_day + p_start, p_day + p_end, '[)');
  select a.start_time, a.end_time, p.name into v_o
    from public.appointments a join public.patients p on p.id = a.patient_id
   where a.therapist_id = p_th and a.status in ('programmata', 'effettuata', 'trattenuta') and a.slot && v_slot and a.id <> v_ign limit 1;
  if found then
    return 'si sovrappone a ' || v_o.name || ' (' || app.fmt_t(v_o.start_time) || '–' || app.fmt_t(v_o.end_time) || ') nel calendario di ' || app.th_name(p_th) || '.';
  end if;
  if p_patient is not null then
    select a.start_time, a.end_time, a.therapist_id into v_o
      from public.appointments a
     where a.patient_id = p_patient and a.status in ('programmata', 'effettuata', 'trattenuta') and a.slot && v_slot and a.id <> v_ign limit 1;
    if found then
      return 'il paziente ha già un appuntamento ' || app.fmt_t(v_o.start_time) || '–' || app.fmt_t(v_o.end_time) || ' con ' || app.th_name(v_o.therapist_id) || '.';
    end if;
  end if;
  return null;
end $$;

-- Controllo di un posto: i conflitti veri bloccano sempre (FA_SLOT); gli avvisi organizzativi
-- bloccano (FA_WARN) solo se non sono stati confermati (p_force).
create or replace function app.guard_slot(p_th uuid, p_day date, p_start time, p_end time, p_patient uuid, p_ignore uuid, p_cycle uuid,
  p_reserve boolean, p_force boolean, p_prefix text default '') returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_msg text;
begin
  v_msg := app.hard_conflict(p_th, p_day, p_start, p_end, p_patient, p_ignore);
  if v_msg is not null then perform app.fail(p_prefix || upper(left(v_msg, 1)) || substr(v_msg, 2), 'FA_SLOT'); end if;
  v_msg := app.check_slot(p_th, p_day, p_start, p_end, p_patient, p_ignore, p_cycle, p_reserve);
  if v_msg is null then return false; end if;
  if not coalesce(p_force, false) then perform app.fail(p_prefix || v_msg, 'FA_WARN'); end if;
  return true; -- avviso confermato
end $$;

create or replace function app.err_text(p_state text, p_msg text) returns text language sql immutable as $$
  select case when p_state = '23P01' then 'si sovrappone a un altro appuntamento (stesso fisioterapista o stesso paziente alla stessa ora).'
              else p_msg end
$$;

-- Sedute di una riga del tabulato. Ogni seduta si salva per conto suo: quelle con un problema vengono
-- saltate e restituite con il motivo. Restituisce {n, d, f, skipped: [{day, start, message}]}.
-- Per ogni seduta: start, minutes (durata), therapist_id (chi la fa, se diverso dal titolare), force.
create or replace function app.import_cell_list(p_batch uuid, p_th uuid, p_cyc uuid, p_pat uuid, p_dur int, p_start time, p_cells jsonb, p_cat text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cell jsonb; v_day date; v_start time; v_mark text; v_dur int; v_n int := 0; v_d int := 0; v_f int := 0; v_th uuid;
  v_skip jsonb := '[]'::jsonb; v_forced boolean;
begin
  for cell in select e from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) e order by (e->>'day')::date loop
    v_day := (cell->>'day')::date;
    v_start := coalesce(nullif(cell->>'start', '')::time, p_start);
    begin
      if v_start is null then perform app.fail('manca l''orario.'); end if;
      v_dur := coalesce(nullif(cell->>'minutes', '')::int, p_dur);
      if v_dur is null or v_dur < 10 or v_dur > 240 then perform app.fail('durata non valida.'); end if;
      v_mark := nullif(cell->>'mark', '');
      v_th := coalesce(nullif(cell->>'therapist_id', '')::uuid, p_th);
      if exists (select 1 from public.appointments a where a.patient_id = p_pat and a.day = v_day and a.status not in ('spostata', 'liberata')) then
        v_d := v_d + 1; continue;
      end if;
      if v_th <> p_th then perform app.require_skill(v_th, p_cat); perform app.lock_th(v_th); end if;
      v_forced := app.guard_slot(v_th, v_day, v_start, v_start + make_interval(mins => v_dur), p_pat, null, p_cyc, false,
                                 coalesce((cell->>'force')::boolean, false));
      insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, sheet_number, sheet_mark, import_batch_id, note,
        substitute_kind, original_therapist_id, created_by)
      values (p_cyc, p_pat, v_th, v_day, v_start, v_start + make_interval(mins => v_dur), nullif(cell->>'number', '')::int, v_mark, p_batch,
        case when v_mark = 'R' then 'Recupero (dal tabulato)' else '' end,
        case when v_th <> p_th then 'singola' end, case when v_th <> p_th then p_th end, auth.uid());
      v_n := v_n + 1;
      if v_forced then v_f := v_f + 1; end if;
    exception when others then
      if sqlstate = '42501' then raise; end if;
      v_skip := v_skip || jsonb_build_object('day', v_day, 'start', app.fmt_t(v_start), 'message', app.err_text(sqlstate, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('n', v_n, 'd', v_d, 'f', v_f, 'skipped', v_skip);
end $$;

-- ---------------------------------------------------------------------
-- Importazione di un tabulato: ogni riga si salva per conto suo.
-- p = { therapist_id, month, from_date, photo_hash, source_hash, label,
--       rows: [{ ref, target: 'nuovo'|'paziente'|'ciclo', patient_name, patient_id, cycle_id, homonym,
--                category_id, treatment, planned, prior, duration, weekdays, start,
--                cells: [{ day, start, minutes, number, mark, force, therapist_id }], visits,
--                next: { planned, prior, cells }, concluded }],
--       extra: [{ ref, target: 'ciclo'|'paziente'|'nuovo', cycle_id, patient_id, patient_name, homonym,
--                 original_therapist_id, therapist_id, category_id, day, start, minutes, number, force }] }
-- Restituisce anche l'esito di ogni riga: results: [{ref, ok, error, cycle_id, appointments, skipped}].
-- ---------------------------------------------------------------------
create or replace function public.import_sheet(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_th uuid := nullif(p->>'therapist_id', '')::uuid;
  v_batch uuid; v_bno bigint;
  r jsonb; cell jsonb; v_pat uuid; v_cyc uuid; v_cyc2 uuid; c public.cycles;
  v_name text; v_dur int; v_start time; v_day date; v_wd int[]; v_times jsonb; v_cat text; v_sub uuid; v_orig uuid;
  v_planned int; v_prior int; v_ref text; v_res jsonb; v_res2 jsonb; v_ncells int; v_num int; v_forced boolean;
  -- totali
  v_new_pat int := 0; v_new_cyc int := 0; v_appts int := 0; v_dups int := 0; v_visits int := 0; v_forced_n int := 0; v_rows int := 0; v_extra_ok int := 0;
  -- per riga (sommati ai totali solo se la riga va a buon fine)
  r_pat int; r_cyc int; r_vis int;
  v_results jsonb := '[]'::jsonb; v_xres jsonb := '[]'::jsonb; v_skipped jsonb;
begin
  perform app.require_role('operatore');
  if v_th is null or not exists (select 1 from public.therapists where id = v_th) then perform app.fail('Scegli il fisioterapista del tabulato.'); end if;
  if nullif(p->>'month', '') is null then perform app.fail('Indica mese e anno del tabulato.'); end if;
  if nullif(p->>'from_date', '') is null then perform app.fail('Indica la data da cui importare.'); end if;
  perform app.lock_th(v_th);
  insert into public.import_batches (therapist_id, month, from_date, photo_hash, source_hash, label, created_by)
  values (v_th, (p->>'month')::date, (p->>'from_date')::date, nullif(p->>'photo_hash', ''), coalesce(p->>'source_hash', ''),
          coalesce(p->>'label', ''), auth.uid())
  returning id, number into v_batch, v_bno;

  for r in select e from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) e loop
    v_ref := coalesce(r->>'ref', '');
    v_name := trim(coalesce(r->>'patient_name', ''));
    begin
      r_pat := 0; r_cyc := 0; r_vis := 0; v_cyc2 := null;
      v_dur := coalesce(nullif(r->>'duration', '')::int, 0);
      v_cyc := null; v_pat := null;
      v_ncells := jsonb_array_length(coalesce(r->'cells', '[]'::jsonb));
      if r->>'target' = 'ciclo' then
        select * into c from public.cycles where id = nullif(r->>'cycle_id', '')::uuid for update;
        if not found then perform app.fail('il ciclo scelto non esiste più: scegli di nuovo il paziente.'); end if;
        if c.status <> 'attivo' then perform app.fail('il ciclo scelto non è più in corso: scegli «stesso paziente, nuovo ciclo».'); end if;
        v_cyc := c.id; v_pat := c.patient_id;
        if v_dur = 0 then v_dur := c.duration; end if;
        select name into v_name from public.patients where id = v_pat;
      else
        if r->>'target' = 'paziente' then
          v_pat := nullif(r->>'patient_id', '')::uuid;
          select name into v_name from public.patients where id = v_pat;
          if not found then perform app.fail('paziente non trovato: scegli di nuovo il paziente.'); end if;
        elsif r->>'target' = 'nuovo' then
          if v_name = '' then perform app.fail('manca il nome del paziente.'); end if;
          if not coalesce((r->>'homonym')::boolean, false)
             and exists (select 1 from public.patients x where app.norm_name(x.name) = app.norm_name(v_name)) then
            perform app.fail('esiste già un paziente «' || v_name || '»: scegli se è lo stesso paziente o un omonimo.', 'FA_CONFLICT');
          end if;
          insert into public.patients (name, import_batch_id) values (v_name, v_batch) returning id into v_pat;
          r_pat := 1;
        else
          perform app.fail('indica se il paziente è nuovo o già presente.');
        end if;
        if not exists (select 1 from public.categories where id = r->>'category_id') then perform app.fail('scegli il percorso.'); end if;
        perform app.require_skill(v_th, r->>'category_id');
        if v_dur < 10 or v_dur > 240 then perform app.fail('durata della seduta non valida.'); end if;
        v_planned := coalesce(nullif(r->>'planned', '')::int, 10);
        v_prior := greatest(coalesce(nullif(r->>'prior', '')::int, 0), 0);
        -- numerazione oltre il previsto (es. un recupero dopo l'ultima seduta): il ciclo si allunga
        if v_prior >= v_planned then v_planned := v_prior + greatest(v_ncells, 1); end if;
        v_wd := coalesce((select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(r->'weekdays') x), '{}');
        if cardinality(v_wd) = 0 then
          v_wd := coalesce((select array_agg(distinct extract(isodow from (e->>'day')::date)::int order by extract(isodow from (e->>'day')::date)::int)
                            from jsonb_array_elements(coalesce(r->'cells', '[]'::jsonb)) e), '{}');
        end if;
        v_start := nullif(r->>'start', '')::time;
        v_times := coalesce((select jsonb_object_agg(w::text, app.fmt_t(v_start)) from unnest(v_wd) w where v_start is not null), '{}'::jsonb);
        insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays,
          weekday_times, start_time, therapist_id, status, treatment, note, import_batch_id, created_by)
        values (v_pat, r->>'category_id', 'NI', case when v_prior > 0 then 'continuazione' else 'prima' end, v_dur, v_planned, v_prior, v_wd,
          v_times, v_start, v_th, 'attivo', coalesce(r->>'treatment', ''), 'Importato dal tabulato (importazione n. ' || v_bno || ').', v_batch, auth.uid())
        returning id into v_cyc;
        r_cyc := 1;
      end if;
      select category_id into v_cat from public.cycles where id = v_cyc;
      v_res := app.import_cell_list(v_batch, v_th, v_cyc, v_pat, v_dur, nullif(r->>'start', '')::time, r->'cells', v_cat);
      v_skipped := v_res->'skipped';
      if coalesce((r->>'concluded')::boolean, false) and jsonb_array_length(coalesce(r->'next'->'cells', '[]'::jsonb)) = 0 then
        update public.cycles set forecast = 'conclusione_confermata' where id = v_cyc;
      end if;
      -- nuovo ciclo dello stesso paziente iniziato sulla stessa riga
      v_res2 := jsonb_build_object('n', 0, 'd', 0, 'f', 0);
      if jsonb_array_length(coalesce(r->'next'->'cells', '[]'::jsonb)) > 0 then
        select * into c from public.cycles where id = v_cyc;
        v_planned := coalesce(nullif(r->'next'->>'planned', '')::int, c.planned_sessions);
        v_prior := greatest(coalesce(nullif(r->'next'->>'prior', '')::int, 0), 0);
        if v_prior >= v_planned then v_planned := v_prior + jsonb_array_length(r->'next'->'cells'); end if;
        insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays,
          weekday_times, start_time, therapist_id, status, treatment, note, import_batch_id, created_by)
        values (v_pat, c.category_id, 'NI', 'continuazione', v_dur, v_planned, v_prior, c.weekdays, c.weekday_times, c.start_time, v_th, 'attivo',
          c.treatment, 'Nuovo ciclo importato dal tabulato (importazione n. ' || v_bno || ').', v_batch, auth.uid())
        returning id into v_cyc2;
        r_cyc := r_cyc + 1;
        v_res2 := app.import_cell_list(v_batch, v_th, v_cyc2, v_pat, v_dur, nullif(r->>'start', '')::time, r->'next'->'cells', c.category_id);
        v_skipped := v_skipped || (v_res2->'skipped');
        if coalesce((r->>'concluded')::boolean, false) then update public.cycles set forecast = 'conclusione_confermata' where id = v_cyc2; end if;
      end if;
      for cell in select e from jsonb_array_elements(coalesce(r->'visits', '[]'::jsonb)) e loop
        insert into public.patient_events (patient_id, day, kind, import_batch_id, created_by)
        values (v_pat, (cell #>> '{}')::date, 'visita_fisiatrica', v_batch, auth.uid())
        on conflict (patient_id, day, kind) do nothing;
        if found then r_vis := r_vis + 1; end if;
      end loop;
      -- riga riuscita: si sommano i totali
      v_rows := v_rows + 1; v_new_pat := v_new_pat + r_pat; v_new_cyc := v_new_cyc + r_cyc; v_visits := v_visits + r_vis;
      v_appts := v_appts + (v_res->>'n')::int + (v_res2->>'n')::int;
      v_dups := v_dups + (v_res->>'d')::int + (v_res2->>'d')::int;
      v_forced_n := v_forced_n + (v_res->>'f')::int + (v_res2->>'f')::int;
      v_results := v_results || jsonb_build_object('ref', v_ref, 'ok', true, 'patient_id', v_pat, 'cycle_id', coalesce(v_cyc2, v_cyc),
        'appointments', (v_res->>'n')::int + (v_res2->>'n')::int, 'skipped', v_skipped);
    exception when others then
      if sqlstate = '42501' then raise; end if;
      v_results := v_results || jsonb_build_object('ref', v_ref, 'ok', false, 'name', v_name, 'error', app.err_text(sqlstate, sqlerrm));
    end;
  end loop;

  -- sedute fatte in sostituzione (pazienti di colleghi scritti su questo foglio, o sostituzioni da assegnare)
  for cell in select e from jsonb_array_elements(coalesce(p->'extra', '[]'::jsonb)) e loop
    v_ref := coalesce(cell->>'ref', '');
    begin
      r_pat := 0; r_cyc := 0;
      v_sub := coalesce(nullif(cell->>'therapist_id', '')::uuid, v_th);
      v_day := (cell->>'day')::date; v_start := nullif(cell->>'start', '')::time;
      if v_day is null then perform app.fail('manca la data.'); end if;
      if v_start is null then perform app.fail('manca l''orario.'); end if;
      v_num := nullif(regexp_replace(coalesce(cell->>'number', ''), '\D', '', 'g'), '')::int;
      if coalesce(nullif(cell->>'target', ''), case when nullif(cell->>'cycle_id', '') is not null then 'ciclo' end) = 'ciclo' then
        select * into c from public.cycles where id = nullif(cell->>'cycle_id', '')::uuid;
        if not found then perform app.fail('ciclo del paziente non trovato: sceglilo di nuovo.'); end if;
        v_pat := c.patient_id; v_cyc := c.id; v_orig := c.therapist_id; v_cat := c.category_id;
        v_dur := coalesce(nullif(cell->>'minutes', '')::int, c.duration);
        if c.status <> 'attivo' then perform app.fail('il ciclo del paziente non è più in corso.'); end if;
      else
        v_orig := coalesce(nullif(cell->>'original_therapist_id', '')::uuid, v_th);
        v_cat := coalesce(nullif(cell->>'category_id', ''), (select id from public.categories order by sort, id limit 1));
        v_dur := coalesce(nullif(cell->>'minutes', '')::int, 30);
        if cell->>'target' = 'paziente' then
          v_pat := nullif(cell->>'patient_id', '')::uuid;
          if not exists (select 1 from public.patients where id = v_pat) then perform app.fail('paziente non trovato.'); end if;
        else
          v_name := trim(coalesce(cell->>'patient_name', ''));
          if v_name = '' then perform app.fail('manca il nome del paziente.'); end if;
          if not coalesce((cell->>'homonym')::boolean, false)
             and exists (select 1 from public.patients x where app.norm_name(x.name) = app.norm_name(v_name)) then
            perform app.fail('esiste già un paziente «' || v_name || '»: sceglilo dall''elenco oppure indica che è un omonimo.', 'FA_CONFLICT');
          end if;
          insert into public.patients (name, import_batch_id) values (v_name, v_batch) returning id into v_pat;
          r_pat := 1;
        end if;
        -- ciclo in corso del paziente con il titolare, altrimenti un nuovo ciclo del titolare
        select * into c from public.cycles where patient_id = v_pat and therapist_id = v_orig and status = 'attivo' order by created_at desc limit 1;
        if found then v_cyc := c.id; v_cat := c.category_id;
        else
          perform app.require_skill(v_orig, v_cat);
          v_planned := 10;
          v_prior := case when v_num between 1 and 10 then 10 - v_num else 0 end;
          insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, prior_sessions, weekdays,
            weekday_times, start_time, therapist_id, status, treatment, note, import_batch_id, created_by)
          values (v_pat, v_cat, 'NI', case when v_prior > 0 then 'continuazione' else 'prima' end, v_dur, v_planned, v_prior,
            array[extract(isodow from v_day)::int], jsonb_build_object((extract(isodow from v_day)::int)::text, app.fmt_t(v_start)), v_start,
            v_orig, 'attivo', '', 'Creato da una sostituzione sul tabulato di ' || app.th_name(v_th) || ' (importazione n. ' || v_bno
            || '): completa le altre sedute dal calendario di ' || app.th_name(v_orig) || '.', v_batch, auth.uid())
          returning id into v_cyc;
          r_cyc := 1;
        end if;
      end if;
      if exists (select 1 from public.appointments a where a.patient_id = v_pat and a.day = v_day and a.status not in ('spostata', 'liberata')) then
        v_dups := v_dups + 1;
        v_xres := v_xres || jsonb_build_object('ref', v_ref, 'ok', true, 'duplicate', true);
        continue;
      end if;
      perform app.require_skill(v_sub, v_cat);
      if v_sub <> v_th then perform app.lock_th(v_sub); end if;
      v_forced := app.guard_slot(v_sub, v_day, v_start, v_start + make_interval(mins => v_dur), v_pat, null, v_cyc, false,
                                 coalesce((cell->>'force')::boolean, false));
      insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, sheet_number, import_batch_id,
        substitute_kind, original_therapist_id, note, created_by)
      values (v_cyc, v_pat, v_sub, v_day, v_start, v_start + make_interval(mins => v_dur), v_num, v_batch,
        case when v_orig is distinct from v_sub then 'singola' end, case when v_orig is distinct from v_sub then v_orig end,
        'Sostituzione dal tabulato', auth.uid());
      v_appts := v_appts + 1; v_extra_ok := v_extra_ok + 1; v_new_pat := v_new_pat + r_pat; v_new_cyc := v_new_cyc + r_cyc;
      if v_forced then v_forced_n := v_forced_n + 1; end if;
      v_xres := v_xres || jsonb_build_object('ref', v_ref, 'ok', true);
    exception when others then
      if sqlstate = '42501' then raise; end if;
      v_xres := v_xres || jsonb_build_object('ref', v_ref, 'ok', false, 'error', app.err_text(sqlstate, sqlerrm));
    end;
  end loop;

  if v_rows = 0 and v_extra_ok = 0 and v_visits = 0 and v_new_pat = 0 then
    -- niente è stato salvato: l'importazione non resta nello storico
    delete from public.import_batches where id = v_batch;
    return jsonb_build_object('batch_id', null, 'number', null, 'rows', 0, 'patients', 0, 'cycles', 0, 'appointments', 0,
      'duplicates', v_dups, 'visits', 0, 'forced', 0, 'results', v_results, 'extra', v_xres);
  end if;
  update public.import_batches set summary = jsonb_build_object('rows', v_rows, 'patients', v_new_pat, 'cycles', v_new_cyc,
    'appointments', v_appts, 'duplicates', v_dups, 'visits', v_visits, 'forced', v_forced_n, 'substitutions', v_extra_ok,
    'failed', (select count(*) from jsonb_array_elements(v_results || v_xres) x where not (x->>'ok')::boolean)) where id = v_batch;
  perform app.log('importazione', 'Importazione n. ' || v_bno || ' dal tabulato di ' || app.th_name(v_th) || ' ('
    || to_char((p->>'month')::date, 'MM/YYYY') || '): ' || v_rows || ' pazienti, ' || v_appts || ' sedute'
    || case when v_extra_ok > 0 then ' (di cui ' || v_extra_ok || ' sostituzioni)' else '' end
    || case when v_dups > 0 then ', ' || v_dups || ' già presenti saltate' else '' end
    || case when v_visits > 0 then ', ' || v_visits || ' visite fisiatriche' else '' end
    || case when v_forced_n > 0 then ', ' || v_forced_n || ' con avvisi confermati' else '' end || '.',
    'import', v_batch::text, jsonb_build_object('label', p->>'label', 'from_date', p->>'from_date'));
  return jsonb_build_object('batch_id', v_batch, 'number', v_bno, 'rows', v_rows, 'patients', v_new_pat, 'cycles', v_new_cyc,
    'appointments', v_appts, 'duplicates', v_dups, 'visits', v_visits, 'forced', v_forced_n, 'substitutions', v_extra_ok,
    'results', v_results, 'extra', v_xres);
end $$;

-- ---------------------------------------------------------------------
-- Modifica di una singola seduta: giorno, ora, durata, fisioterapista.
-- p = { therapist_id, day, start, minutes, force, note }
-- Un altro fisioterapista = sostituzione (il ciclo resta del titolare); tornare al titolare la annulla.
-- ---------------------------------------------------------------------
create or replace function public.edit_appointment(p_id uuid, p_version int, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; c public.cycles; v_th uuid; v_day date; v_start time; v_min int; v_end time; v_pname text; v_forced boolean; v_orig uuid;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_id for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if a.status not in ('programmata', 'da_riprogrammare', 'effettuata') then
    perform app.fail('Questa seduta (' || a.status || ') non si può modificare: si modificano le sedute programmate, da riprogrammare o effettuate.');
  end if;
  select * into c from public.cycles where id = a.cycle_id;
  v_th := coalesce(nullif(p->>'therapist_id', '')::uuid, a.therapist_id);
  v_day := coalesce(nullif(p->>'day', '')::date, a.day);
  v_start := coalesce(nullif(p->>'start', '')::time, a.start_time);
  v_min := coalesce(nullif(p->>'minutes', '')::int, (extract(epoch from (a.end_time - a.start_time)) / 60)::int);
  if v_min < 10 or v_min > 240 then perform app.fail('Durata non valida (da 10 a 240 minuti).'); end if;
  v_end := v_start + make_interval(mins => v_min);
  if v_end <= v_start then perform app.fail('La seduta deve finire entro la mezzanotte.'); end if;
  if v_day < app.today() and a.day >= app.today() then perform app.fail('Non si può spostare una seduta futura in una data passata.'); end if;
  if a.status = 'effettuata' and (v_day <> a.day or v_th <> a.therapist_id) then
    perform app.fail('Di una seduta già effettuata si possono correggere solo orario e durata.');
  end if;
  perform app.require_skill(v_th, c.category_id);
  perform app.lock_th(v_th);
  v_forced := app.guard_slot(v_th, v_day, v_start, v_end, a.patient_id, a.id, a.cycle_id, a.status <> 'effettuata', coalesce((p->>'force')::boolean, false));
  v_orig := coalesce(a.original_therapist_id, c.therapist_id);
  update public.appointments set therapist_id = v_th, day = v_day, start_time = v_start, end_time = v_end,
    status = case when a.status = 'da_riprogrammare' then 'programmata' else a.status end,
    reason = case when a.status = 'da_riprogrammare' then '' else reason end,
    note = coalesce(nullif(p->>'note', ''), note),
    substitute_kind = case when v_th = v_orig then null else coalesce(a.substitute_kind, 'singola') end,
    original_therapist_id = case when v_th = v_orig then null else v_orig end
  where id = a.id;
  perform app.log(case when v_th <> a.therapist_id then 'sostituzione' else 'spostamento' end,
    v_pname || ': seduta del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || '–' || app.fmt_t(a.end_time) || ' con ' || app.th_name(a.therapist_id)
    || ' → ' || app.fmt_d(v_day) || ' ' || app.fmt_t(v_start) || '–' || app.fmt_t(v_end) || ' con ' || app.th_name(v_th)
    || case when v_th <> v_orig then ' (sostituisce ' || app.th_name(v_orig) || ')' when a.original_therapist_id is not null then ' (sostituzione annullata)' else '' end
    || case when v_forced then ' — avviso confermato' else '' end || '.', 'appointment', a.id::text, p);
  return jsonb_build_object('forced', v_forced);
exception when exclusion_violation then
  raise exception 'Il posto è stato appena occupato da un altro utente.' using hint = 'FA_SLOT';
end $$;

-- Sedute aggiunte a un ciclo in corso: durata per ogni seduta, avvisi confermabili;
-- se si supera il numero previsto il ciclo si allunga (nessun blocco).
drop function if exists public.add_cycle_slots(uuid, int, uuid, jsonb);
create or replace function public.add_cycle_slots(p_cycle uuid, p_version int, p_therapist uuid, p_slots jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; it jsonb; v_d date; v_s time; v_min int; v_n int := 0; v_used int; v_pname text; v_more int := 0;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status <> 'attivo' then perform app.fail('Si possono aggiungere sedute solo a un ciclo in corso.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  select count(*) into v_used from public.appointments a where a.cycle_id = c.id and a.recovery_of is null and a.sheet_mark is null
     and a.status in ('programmata', 'effettuata', 'trattenuta', 'da_riprogrammare');
  v_more := c.prior_sessions + v_used + coalesce(jsonb_array_length(p_slots), 0) - c.planned_sessions;
  if v_more > 0 then
    update public.cycles set planned_sessions = planned_sessions + v_more where id = c.id;
  end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  for it in select e from jsonb_array_elements(p_slots) e order by (e->>'day')::date loop
    v_d := (it->>'day')::date; v_s := (it->>'start')::time;
    v_min := coalesce(nullif(it->>'minutes', '')::int, c.duration);
    if v_min < 10 or v_min > 240 then perform app.fail('Durata non valida.'); end if;
    perform app.guard_slot(p_therapist, v_d, v_s, v_s + make_interval(mins => v_min), c.patient_id, null, c.id, false,
      coalesce(p_force, false), 'Seduta del ' || app.fmt_d(v_d) || ' alle ' || app.fmt_t(v_s) || ': ');
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, substitute_kind, original_therapist_id, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, v_s, v_s + make_interval(mins => v_min),
      case when c.therapist_id is distinct from p_therapist then 'singola' end, case when c.therapist_id is distinct from p_therapist then c.therapist_id end, auth.uid());
    v_n := v_n + 1;
  end loop;
  perform app.log('prenotazione', v_pname || ': ' || v_n || ' sedute aggiunte al ciclo con ' || app.th_name(p_therapist)
    || case when v_more > 0 then ' (ciclo allungato di ' || v_more || ')' else '' end || '.', 'cycle', c.id::text, p_slots);
  return jsonb_build_object('added', v_n, 'extended', greatest(v_more, 0));
exception when exclusion_violation then
  raise exception 'Un posto è stato appena occupato da un altro utente. Nessuna seduta è stata salvata: riprova.' using hint = 'FA_SLOT';
end $$;

-- Prenotazione di un ciclo nuovo: durata per ogni seduta, avvisi confermabili
drop function if exists public.book_cycle_slots(uuid, int, uuid, jsonb, int[]);
create or replace function public.book_cycle_slots(p_cycle uuid, p_version int, p_therapist uuid, p_slots jsonb, p_weekdays int[], p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; it jsonb; v_d date; v_s time; v_min int; v_n int := 0; v_pname text; v_times jsonb := '{}'::jsonb; v_first time;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Richiesta non trovata.'); end if;
  if c.version <> p_version then perform app.stale('La richiesta', c.updated_by); end if;
  if c.status <> 'in_attesa' then perform app.fail('Il ciclo è già stato prenotato.', 'FA_CONFLICT'); end if;
  if coalesce(jsonb_array_length(p_slots), 0) <> c.planned_sessions - c.prior_sessions then
    perform app.fail('Servono ' || (c.planned_sessions - c.prior_sessions) || ' sedute da programmare, ne sono state indicate ' || coalesce(jsonb_array_length(p_slots), 0) || '.');
  end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  select name into v_pname from public.patients where id = c.patient_id;
  for it in select e from jsonb_array_elements(p_slots) e order by (e->>'day')::date loop
    v_d := (it->>'day')::date; v_s := (it->>'start')::time;
    v_min := coalesce(nullif(it->>'minutes', '')::int, c.duration);
    if v_d < app.today() and not coalesce(p_force, false) then perform app.fail('La data ' || app.fmt_d(v_d) || ' è già passata.', 'FA_WARN'); end if;
    perform app.guard_slot(p_therapist, v_d, v_s, v_s + make_interval(mins => v_min), c.patient_id, null, c.id, true,
      coalesce(p_force, false), 'Seduta del ' || app.fmt_d(v_d) || ' alle ' || app.fmt_t(v_s) || ': ');
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, v_s, v_s + make_interval(mins => v_min), auth.uid());
    if v_first is null then v_first := v_s; end if;
    v_times := v_times || jsonb_build_object((extract(isodow from v_d)::int)::text, app.fmt_t(v_s));
    v_n := v_n + 1;
  end loop;
  update public.cycles set status = 'attivo', therapist_id = p_therapist, start_time = v_first, weekday_times = v_times,
    weekdays = coalesce(p_weekdays, weekdays) where id = c.id;
  perform app.log('prenotazione', 'Prenotato il ciclo di ' || v_pname || ' con ' || app.th_name(p_therapist) || ': ' || v_n
    || ' sedute' || case when c.prior_sessions > 0 then ' (già svolte ' || c.prior_sessions || ')' else '' end || ', dal '
    || app.fmt_d((p_slots->0->>'day')::date) || '.', 'cycle', c.id::text, jsonb_build_object('therapist_id', p_therapist, 'slots', p_slots));
  return jsonb_build_object('booked', v_n);
exception when exclusion_violation then
  raise exception 'Un posto è stato appena occupato da un altro utente. Nessuna seduta è stata salvata: riprova.' using hint = 'FA_SLOT';
end $$;

-- Sostituzione annullata in blocco (es. dalla pagina Sostituzioni): la seduta torna "da assegnare"
-- al titolare. Se il titolare è assente resta segnalata in "Da sistemare".
create or replace function public.cancel_substitution(p_id uuid, p_version int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_pname text; v_orig uuid;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_id for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if a.status <> 'programmata' then perform app.fail('Si annullano solo sostituzioni di sedute programmate.'); end if;
  v_orig := coalesce(a.original_therapist_id, (select therapist_id from public.cycles where id = a.cycle_id));
  if v_orig = a.therapist_id then perform app.fail('Questa seduta non è una sostituzione.'); end if;
  if app.hard_conflict(v_orig, a.day, a.start_time, a.end_time, a.patient_id, a.id) is null then
    update public.appointments set therapist_id = v_orig, substitute_kind = null, original_therapist_id = null where id = a.id;
  else
    -- il titolare ha già un altro paziente a quell'ora: la seduta resta da riprogrammare
    update public.appointments set therapist_id = v_orig, substitute_kind = null, original_therapist_id = null,
      status = 'da_riprogrammare', reason = 'Sostituzione annullata: da assegnare' where id = a.id;
  end if;
  perform app.log('sostituzione', v_pname || ': sostituzione del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ' con '
    || app.th_name(a.therapist_id) || ' annullata: la seduta torna a ' || app.th_name(v_orig) || '.', 'appointment', a.id::text, null);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('import_sheet', 'edit_appointment', 'add_cycle_slots', 'book_cycle_slots', 'cancel_substitution') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.hard_conflict(uuid, date, time, time, uuid, uuid) from public, anon;
revoke all on function app.guard_slot(uuid, date, time, time, uuid, uuid, uuid, boolean, boolean, text) from public, anon;
revoke all on function app.import_cell_list(uuid, uuid, uuid, uuid, int, time, jsonb, text) from public, anon;
