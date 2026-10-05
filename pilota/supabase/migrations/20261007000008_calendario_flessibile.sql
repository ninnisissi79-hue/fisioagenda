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
