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
