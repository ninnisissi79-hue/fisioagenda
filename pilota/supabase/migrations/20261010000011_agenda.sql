-- =====================================================================
-- FisioAgenda — versione pilota: l'agenda del fisioterapista al centro.
-- - autorizzazioni: un collega può modificare le agende altrui (o fare da
--   sostituto della segreteria) fino a una data scelta dal coordinatore;
--   consultazione e modifica restano separate e controllate dal database
-- - settimana tipo, variazioni di un giorno e attività: le gestisce chi può
--   modificare quel calendario (il fisioterapista il proprio, la segreteria tutti)
-- - scambio di due appuntamenti in un'unica operazione
-- - annullamento di una modifica errata, solo se nessuno l'ha cambiata dopo
-- Si può eseguire più volte.
-- =====================================================================

alter table public.profiles add column if not exists edit_all_until date;

-- Ruolo effettivo: con l'autorizzazione in corso il collega (o un account di consultazione)
-- lavora con gli strumenti della segreteria.
create or replace function app.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when p.role in ('fisioterapista', 'lettura') and p.edit_all_until is not null
                   and p.edit_all_until >= (now() at time zone 'Europe/Rome')::date then 'operatore' else p.role end
    from public.profiles p where p.user_id = auth.uid() and p.active
$$;

-- Chi può modificare il calendario di questo fisioterapista
create or replace function app.require_calendar(p_th uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_role('operatore');
  if app.my_role() = 'fisioterapista' and p_th is distinct from app.my_therapist() then
    raise exception 'Puoi modificare solo il tuo calendario (%). Per le agende dei colleghi serve l''autorizzazione del coordinatore.',
      coalesce(app.th_name(app.my_therapist()), '') using errcode = '42501', hint = 'FA_PERM';
  end if;
end $$;

create or replace function public.whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where user_id = auth.uid();
  if not found then return jsonb_build_object('role', null, 'today', app.today()); end if;
  return jsonb_build_object('user_id', v.user_id, 'email', v.email, 'full_name', v.full_name,
    'role', case when v.active then app.my_role() end, 'base_role', case when v.active then v.role end,
    'edit_all_until', v.edit_all_until, 'active', v.active, 'therapist_id', v.therapist_id, 'today', app.today(), 'now', now());
end $$;

drop function if exists public.admin_set_user(uuid, text, boolean, text, uuid);
create or replace function public.admin_set_user(p_user uuid, p_role text, p_active boolean, p_full_name text, p_therapist uuid default null, p_edit_until date default null)
returns void language plpgsql security definer set search_path = '' as $$
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
    therapist_id = case when p_role = 'fisioterapista' then p_therapist end,
    edit_all_until = case when p_role in ('fisioterapista', 'lettura') then p_edit_until end
  where user_id = p_user;
  perform app.log('utenti', 'Account ' || v.email || ': ruolo ' || p_role
    || case when p_role = 'fisioterapista' and p_therapist is not null then ' (' || coalesce(app.th_name(p_therapist), '') || ')' else '' end
    || case when p_role in ('fisioterapista', 'lettura') and p_edit_until is not null
         then ', autorizzato a gestire tutte le agende fino al ' || app.fmt_d(p_edit_until) else '' end
    || case when p_active then '' else ', disattivato' end || '.', 'profile', p_user::text, null);
end $$;

-- Più modifiche tecniche della stessa riga nella stessa operazione diventano una sola
-- (serve all'annullamento: "com'era prima" è lo stato prima dell'operazione).
create or replace function app.squash_changes(p_tbl text, p_row text, p_from bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_first bigint; v_last bigint;
begin
  select min(id), max(id) into v_first, v_last from public.row_changes where tbl = p_tbl and row_id = p_row and id > p_from;
  if v_first is null or v_first = v_last then return; end if;
  update public.row_changes set old_row = (select old_row from public.row_changes where id = v_first) where id = v_last;
  delete from public.row_changes where tbl = p_tbl and row_id = p_row and id > p_from and id < v_last;
end $$;

-- ---------------------------------------------------------------------
-- Scambio di due appuntamenti programmati: ognuno prende giorno, ora e
-- fisioterapista dell'altro, con la propria durata. Un'unica operazione.
-- ---------------------------------------------------------------------
create or replace function public.swap_appointments(p_a uuid, p_va int, p_b uuid, p_vb int, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; b public.appointments; ca public.cycles; cb public.cycles; v_from bigint;
  na_end time; nb_end time; na text; nb text; v_msg text; v_forced boolean := false; oa uuid; ob uuid;
begin
  perform app.require_role('operatore');
  if p_a = p_b then perform app.fail('Scegli due appuntamenti diversi.'); end if;
  perform 1 from public.appointments where id in (p_a, p_b) order by id for update;
  select * into a from public.appointments where id = p_a;
  select * into b from public.appointments where id = p_b;
  if a.id is null or b.id is null then perform app.fail('Uno dei due appuntamenti non esiste più.'); end if;
  select name into na from public.patients where id = a.patient_id;
  select name into nb from public.patients where id = b.patient_id;
  if a.version <> p_va then perform app.stale('L''appuntamento di ' || na, a.updated_by); end if;
  if b.version <> p_vb then perform app.stale('L''appuntamento di ' || nb, b.updated_by); end if;
  if a.status <> 'programmata' or b.status <> 'programmata' then perform app.fail('Si scambiano solo sedute programmate.'); end if;
  if a.patient_id = b.patient_id then perform app.fail('Sono due sedute dello stesso paziente: usa «Modifica».'); end if;
  select * into ca from public.cycles where id = a.cycle_id;
  select * into cb from public.cycles where id = b.cycle_id;
  perform app.require_skill(b.therapist_id, ca.category_id);
  perform app.require_skill(a.therapist_id, cb.category_id);
  perform app.lock_th(x) from (select distinct unnest(array[a.therapist_id, b.therapist_id]) x order by 1) s;
  na_end := b.start_time + (a.end_time - a.start_time);
  nb_end := a.start_time + (b.end_time - b.start_time);
  if na_end <= b.start_time or nb_end <= a.start_time then perform app.fail('Orario non valido dopo lo scambio.'); end if;
  select coalesce(max(id), 0) into v_from from public.row_changes;
  -- per un istante entrambi liberano il posto, così ognuno può prendere quello dell'altro
  update public.appointments set status = 'liberata' where id in (a.id, b.id);
  v_msg := app.hard_conflict(b.therapist_id, b.day, b.start_time, na_end, a.patient_id, a.id);
  if v_msg is not null then perform app.fail(na || ' nel posto di ' || nb || ': ' || v_msg || ' (la durata di ' || na || ' è diversa).', 'FA_SLOT'); end if;
  v_msg := app.hard_conflict(a.therapist_id, a.day, a.start_time, nb_end, b.patient_id, b.id);
  if v_msg is not null then perform app.fail(nb || ' nel posto di ' || na || ': ' || v_msg || ' (la durata di ' || nb || ' è diversa).', 'FA_SLOT'); end if;
  v_msg := coalesce(app.check_slot(b.therapist_id, b.day, b.start_time, na_end, a.patient_id, a.id, a.cycle_id, true),
                    app.check_slot(a.therapist_id, a.day, a.start_time, nb_end, b.patient_id, b.id, b.cycle_id, true));
  if v_msg is not null then
    if not coalesce(p_force, false) then perform app.fail(v_msg, 'FA_WARN'); end if;
    v_forced := true;
  end if;
  oa := coalesce(a.original_therapist_id, ca.therapist_id);
  ob := coalesce(b.original_therapist_id, cb.therapist_id);
  update public.appointments set therapist_id = b.therapist_id, day = b.day, start_time = b.start_time, end_time = na_end, status = 'programmata',
    substitute_kind = case when b.therapist_id = oa then null else coalesce(a.substitute_kind, 'singola') end,
    original_therapist_id = case when b.therapist_id = oa then null else oa end
  where id = a.id;
  update public.appointments set therapist_id = a.therapist_id, day = a.day, start_time = a.start_time, end_time = nb_end, status = 'programmata',
    substitute_kind = case when a.therapist_id = ob then null else coalesce(b.substitute_kind, 'singola') end,
    original_therapist_id = case when a.therapist_id = ob then null else ob end
  where id = b.id;
  perform app.squash_changes('appointments', a.id::text, v_from);
  perform app.squash_changes('appointments', b.id::text, v_from);
  perform app.log('scambio', 'Scambiati di posto ' || na || ' (' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ', ' || app.th_name(a.therapist_id) || ') e '
    || nb || ' (' || app.fmt_d(b.day) || ' ' || app.fmt_t(b.start_time) || ', ' || app.th_name(b.therapist_id) || ')'
    || case when v_forced then ' — avviso confermato' else '' end || '.', 'appointment', a.id::text, jsonb_build_object('a', a.id, 'b', b.id));
  return jsonb_build_object('forced', v_forced);
exception when exclusion_violation then
  raise exception 'Il posto è stato appena occupato da un altro utente: nessuno scambio effettuato.' using hint = 'FA_SLOT';
end $$;

-- ---------------------------------------------------------------------
-- Annulla l'ultima modifica di una o più sedute (es. le due di uno scambio),
-- solo se nessuno le ha cambiate dopo: non si cancellano interventi successivi.
-- ---------------------------------------------------------------------
drop function if exists public.undo_appointment_change(uuid[]);
create or replace function public.undo_appointment_change(p_ids uuid[], p_versions int[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; a public.appointments; rc public.row_changes; v_from bigint; o jsonb; v_names text := ''; v_who text; i int := 0;
begin
  perform app.require_role('operatore');
  if coalesce(array_length(p_ids, 1), 0) = 0 then perform app.fail('Niente da annullare.'); end if;
  select coalesce(max(id), 0) into v_from from public.row_changes;
  perform 1 from public.appointments where id = any(p_ids) order by id for update;
  foreach v_id in array p_ids loop
    i := i + 1;
    select * into a from public.appointments where id = v_id;
    if not found then perform app.fail('La seduta non esiste più.'); end if;
    select * into rc from public.row_changes where tbl = 'appointments' and row_id = v_id::text order by id desc limit 1;
    if not found or rc.op <> 'UPDATE' or rc.old_row is null then perform app.fail('Per questa seduta non c''è una modifica da annullare.'); end if;
    -- p_versions: la versione lasciata dalla modifica da annullare (se qualcuno ha cambiato dopo, non si tocca)
    if (rc.new_row->>'version')::int is distinct from a.version or (p_versions is not null and p_versions[i] is distinct from a.version) then
      select coalesce(full_name, email) into v_who from public.profiles where user_id = a.updated_by;
      perform app.fail('La seduta di ' || app.th_name(a.therapist_id) || ' è stata modificata di nuovo' || coalesce(' da ' || v_who, '') || ': l''annullamento automatico non è più possibile, correggila a mano.', 'FA_CONFLICT');
    end if;
    if a.recovered_by is not null then perform app.fail('La seduta ha già un recupero programmato: correggi a mano.'); end if;
  end loop;
  update public.appointments set status = 'liberata' where id = any(p_ids);
  foreach v_id in array p_ids loop
    select old_row into o from public.row_changes where tbl = 'appointments' and row_id = v_id::text and id <= v_from order by id desc limit 1;
    update public.appointments set therapist_id = (o->>'therapist_id')::uuid, day = (o->>'day')::date, start_time = (o->>'start_time')::time,
      end_time = (o->>'end_time')::time, status = o->>'status', to_recover = coalesce((o->>'to_recover')::boolean, false), cancel_by = o->>'cancel_by',
      substitute_kind = o->>'substitute_kind', original_therapist_id = (o->>'original_therapist_id')::uuid, freed_for = o->>'freed_for',
      reason = coalesce(o->>'reason', ''), note = coalesce(o->>'note', '')
    where id = v_id;
    perform app.squash_changes('appointments', v_id::text, v_from);
    v_names := v_names || case when v_names = '' then '' else ', ' end || (select name from public.patients p join public.appointments x on x.patient_id = p.id where x.id = v_id)
      || ' (' || app.fmt_d((o->>'day')::date) || ' ' || app.fmt_t((o->>'start_time')::time) || ')';
  end loop;
  perform app.log('annullamento', 'Annullata l''ultima modifica: ' || v_names || ' tornano com''erano.', 'appointment', p_ids[1]::text, to_jsonb(p_ids));
  return jsonb_build_object('restored', array_length(p_ids, 1));
exception when exclusion_violation then
  raise exception 'Il posto di prima è stato occupato nel frattempo: l''annullamento non è possibile, sposta la seduta a mano.' using hint = 'FA_SLOT';
end $$;

-- Settimana tipo, variazioni di un giorno e schemi: chi può modificare quel calendario
create or replace function public.admin_save_shift(p_th uuid, p_valid_from date, p_week jsonb, p_note text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conf jsonb; d int; v_next date;
begin
  perform app.require_calendar(p_th);
  if p_valid_from < app.today() and exists (select 1 from public.shift_versions where therapist_id = p_th) then
    perform app.fail('La decorrenza non può essere nel passato: lo storico dei turni va conservato.');
  end if;
  for d in 1..7 loop
    perform app.validate_blocks(coalesce(p_week -> d::text, '[]'::jsonb), 'Turno, ' || (array['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'])[d]);
  end loop;
  select min(valid_from) into v_next from public.shift_versions where therapist_id = p_th and valid_from > p_valid_from;
  begin
    insert into public.shift_versions (therapist_id, valid_from, week, note, created_by)
    values (p_th, p_valid_from, p_week, coalesce(p_note, ''), auth.uid())
    on conflict (therapist_id, valid_from) do update set week = excluded.week, note = excluded.note, created_by = excluded.created_by, created_at = now();
    v_conf := app.th_conflicts(p_th, greatest(p_valid_from, app.today()), v_next - 1);
    if p_dry_run then raise exception using errcode = 'P0099', message = 'anteprima'; end if;
  exception when sqlstate 'P0099' then
    return jsonb_build_object('dry_run', true, 'conflicts', v_conf);
  end;
  perform app.log('turno', 'Nuovo turno di ' || app.th_name(p_th) || ' in vigore dal ' || app.fmt_d(p_valid_from) || '. '
    || jsonb_array_length(v_conf) || ' appuntamenti già prenotati non compatibili, segnalati da sistemare.', 'therapist', p_th::text,
    jsonb_build_object('valid_from', p_valid_from, 'week', p_week, 'conflicts', v_conf));
  return jsonb_build_object('dry_run', false, 'conflicts', v_conf);
end $function$;

create or replace function public.admin_save_shift_range(p_th uuid, p_from date, p_to date, p_week jsonb, p_note text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prev jsonb; v_conf jsonb; d int; v_mid date;
begin
  perform app.require_calendar(p_th);
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
end $function$;

create or replace function public.admin_set_day_override(p_th uuid, p_day date, p_blocks jsonb, p_note text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conf jsonb;
begin
  perform app.require_calendar(p_th);
  if p_blocks is not null then perform app.validate_blocks(p_blocks, 'Variazione del ' || app.fmt_d(p_day)); end if;
  begin
    if p_blocks is null then
      delete from public.day_overrides where therapist_id = p_th and day = p_day;
    else
      insert into public.day_overrides (therapist_id, day, blocks, note, updated_by) values (p_th, p_day, p_blocks, coalesce(p_note, ''), auth.uid())
      on conflict (therapist_id, day) do update set blocks = excluded.blocks, note = excluded.note;
    end if;
    v_conf := app.th_conflicts(p_th, p_day, p_day);
    if p_dry_run then raise exception using errcode = 'P0099', message = 'anteprima'; end if;
  exception when sqlstate 'P0099' then
    return jsonb_build_object('dry_run', true, 'conflicts', v_conf);
  end;
  perform app.log('variazione', case when p_blocks is null then 'Rimossa la variazione' else 'Variazione dell''orario' end
    || ' di ' || app.th_name(p_th) || ' per il ' || app.fmt_d(p_day) || '. ' || jsonb_array_length(v_conf) || ' appuntamenti non compatibili.',
    'therapist', p_th::text, jsonb_build_object('day', p_day, 'blocks', p_blocks));
  return jsonb_build_object('dry_run', false, 'conflicts', v_conf);
end $function$;

create or replace function public.admin_save_template(p_id uuid, p_name text, p_week jsonb, p_delete boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid := p_id; d int;
begin
  perform app.require_role('operatore');
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
end $function$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('whoami', 'admin_set_user', 'swap_appointments', 'undo_appointment_change',
              'admin_save_shift', 'admin_save_shift_range', 'admin_set_day_override', 'admin_save_template') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.require_calendar(uuid) from public, anon;
revoke all on function app.squash_changes(text, text, bigint) from public, anon;
grant execute on function app.my_role() to authenticated;
