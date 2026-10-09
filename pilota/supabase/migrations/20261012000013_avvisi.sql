-- =====================================================================
-- FisioAgenda — versione pilota: avvisi.
-- - primo livello, per il fisioterapista titolare del tabulato: paziente nuovo inserito da altri
--   nel suo tabulato, oppure paziente di un collega (assente) affidato a lui. Un avviso per paziente
--   e per operazione, con le sedute coinvolte; «Visto» lo spegne.
-- - secondo livello (spia gialla) per segreteria, coordinatore, programmatore e chi ne fa le veci:
--   solo le modifiche ai tabulati fatte dai fisioterapisti.
-- Si può eseguire più volte.
-- =====================================================================

create table if not exists public.therapist_alerts (
  id           bigserial primary key,
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  kind         text not null check (kind in ('nuovo_paziente', 'sostituzione')),
  cycle_id     uuid not null,
  patient_id   uuid not null,
  owner_id     uuid,              -- titolare del paziente (per le sostituzioni)
  tx           bigint not null,   -- un avviso per operazione
  at           timestamptz not null default now(),
  by_user      uuid,
  by_name      text not null default '',
  sessions     jsonb not null default '[]'::jsonb,
  seen_at      timestamptz,
  unique (therapist_id, kind, cycle_id, tx)
);
create index if not exists therapist_alerts_th_idx on public.therapist_alerts (therapist_id, seen_at);
alter table public.therapist_alerts enable row level security;
revoke all on public.therapist_alerts from anon, authenticated;

create or replace function app.alert_on_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_kind text;
begin
  if current_setting('app.restoring', true) = 'on' then return null; end if;
  if new.status <> 'programmata' or new.day < (now() at time zone 'Europe/Rome')::date then return null; end if;
  if tg_op = 'UPDATE' and old.therapist_id = new.therapist_id then return null; end if;
  -- la seduta torna al titolare dopo una sostituzione: niente di nuovo per lui
  if tg_op = 'UPDATE' and old.original_therapist_id = new.therapist_id then return null; end if;
  -- chi lavora sul proprio tabulato non riceve avvisi da se stesso
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.therapist_id = new.therapist_id) then return null; end if;
  select coalesce(new.original_therapist_id, c.therapist_id) into v_owner from public.cycles c where c.id = new.cycle_id;
  if v_owner is not null and v_owner <> new.therapist_id then
    v_kind := 'sostituzione';
  elsif not exists (select 1 from public.appointments o
                     where o.cycle_id = new.cycle_id and o.therapist_id = new.therapist_id and o.id <> new.id and o.updated_at < now()) then
    -- prima volta di questo paziente nel tabulato (non un ritorno dal sostituto, non sedute aggiunte)
    v_kind := 'nuovo_paziente';
  else
    return null;
  end if;
  insert into public.therapist_alerts as t (therapist_id, kind, cycle_id, patient_id, owner_id, tx, by_user, by_name, sessions)
  values (new.therapist_id, v_kind, new.cycle_id, new.patient_id, case when v_kind = 'sostituzione' then v_owner end,
          txid_current(), auth.uid(), coalesce(app.my_name(), 'sistema'),
          jsonb_build_array(jsonb_build_object('id', new.id, 'day', new.day, 'start', app.fmt_t(new.start_time), 'end', app.fmt_t(new.end_time))))
  on conflict (therapist_id, kind, cycle_id, tx) do update
    set sessions = t.sessions || excluded.sessions;
  return null;
end $$;
revoke all on function app.alert_on_appointment() from public, anon;

drop trigger if exists alert_on_appointment on public.appointments;
create trigger alert_on_appointment after insert or update of therapist_id on public.appointments
  for each row execute function app.alert_on_appointment();

-- avvisi non ancora visti del fisioterapista collegato all'account
create or replace function public.my_alerts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_th uuid;
begin
  select p.therapist_id into v_th from public.profiles p where p.user_id = auth.uid() and p.active;
  if v_th is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select t.id, t.kind, t.at, t.by_name, t.cycle_id, t.patient_id, t.owner_id,
           pa.name as patient_name, app.th_name(t.owner_id) as owner_name,
           (select jsonb_agg(s order by s->>'day', s->>'start') from jsonb_array_elements(t.sessions) s) as sessions,
           -- motivo della sostituzione: assenza del titolare nel primo giorno
           (select ab.kind from public.absences ab
             where t.owner_id is not null and ab.therapist_id = t.owner_id and not ab.cancelled
               and ab.start_date <= (t.sessions->0->>'day')::date and coalesce(ab.end_date, 'infinity'::date) >= (t.sessions->0->>'day')::date
             order by ab.created_at desc limit 1) as owner_absence
      from public.therapist_alerts t
      left join public.patients pa on pa.id = t.patient_id
     where t.therapist_id = v_th and t.seen_at is null and t.at > now() - interval '60 days'
     order by t.id desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.mark_alerts_seen(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_th uuid; v_n int;
begin
  perform app.require_role('lettura');
  select p.therapist_id into v_th from public.profiles p where p.user_id = auth.uid();
  update public.therapist_alerts set seen_at = now()
   where therapist_id = v_th and seen_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- spia gialla: solo le modifiche fatte dai fisioterapisti (anche se autorizzati a tempo)
create or replace function public.my_changes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.my_role() is null or app.my_role() not in ('programmatore', 'admin', 'operatore') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select l.id, l.at, l.user_name, l.action, l.summary, l.entity, l.entity_id,
           pr.therapist_id as by_therapist
      from public.audit_log l
      join public.profiles pr on pr.user_id = l.user_id and pr.role = 'fisioterapista'
     where l.at > now() - interval '30 days' and l.action = any(app.calendar_actions())
       and l.user_id is distinct from auth.uid()
       and not exists (select 1 from public.change_seen s where s.user_id = auth.uid() and s.audit_id = l.id)
     order by l.id desc limit 200) x), '[]'::jsonb);
end $$;

-- svuotamento: anche gli avvisi dei pazienti cancellati
create or replace function public.admin_clear_patients(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p int; v_a int;
begin
  perform app.require_role('admin');
  if coalesce(p_confirm, '') <> 'SVUOTA' then perform app.fail('Per confermare scrivi SVUOTA.'); end if;
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
  perform set_config('app.restoring', 'off', true);
  perform app.log('svuotamento', 'Archivio dei pazienti svuotato: ' || v_p || ' pazienti e ' || v_a || ' sedute eliminati. Fisioterapisti, orari e assenze restano.',
    null, null, jsonb_build_object('patients', v_p, 'appointments', v_a));
  return jsonb_build_object('patients', v_p, 'appointments', v_a);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('my_alerts', 'mark_alerts_seen', 'my_changes', 'admin_clear_patients') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- per segreteria/accettazione, coordinatore, programmatore (e chi ne fa le veci):
-- gli avvisi inviati ai fisioterapisti e se li hanno letti (✓ inviato, ✓✓ letto)
create or replace function public.office_alerts(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.my_role() is null or app.my_role() not in ('programmatore', 'admin', 'operatore') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select t.id, t.therapist_id, t.kind, t.at, t.by_name, t.patient_id, t.owner_id, t.seen_at,
           pa.name as patient_name, app.th_name(t.therapist_id) as therapist_name, app.th_name(t.owner_id) as owner_name,
           jsonb_array_length(t.sessions) as n_sessions, t.sessions->0->>'day' as first_day,
           exists (select 1 from public.profiles p where p.therapist_id = t.therapist_id and p.active) as has_account
      from public.therapist_alerts t
      left join public.patients pa on pa.id = t.patient_id
     where t.at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)))
     order by t.id desc limit 300) x), '[]'::jsonb);
end $$;
revoke all on function public.office_alerts(int) from public, anon;
grant execute on function public.office_alerts(int) to authenticated;

-- lettura in tempo reale: il «Visto» del fisioterapista arriva subito a segreteria, coordinatore e programmatore
drop policy if exists leggono on public.therapist_alerts;
create policy leggono on public.therapist_alerts for select to authenticated using (
  app.my_role() in ('programmatore', 'admin', 'operatore')
  or therapist_id = (select p.therapist_id from public.profiles p where p.user_id = auth.uid()));
grant select on public.therapist_alerts to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'therapist_alerts') then
    alter publication supabase_realtime add table public.therapist_alerts;
  end if;
end $$;
