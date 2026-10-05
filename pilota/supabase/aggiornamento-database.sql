-- FisioAgenda pilota: AGGIORNAMENTO del database esistente (sedute già svolte, ruoli, previsione cicli, tipi di fascia, calendario flessibile).
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
