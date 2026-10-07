-- =====================================================================
-- FisioAgenda — versione pilota: tabulato mensile semplificato.
-- - presenza non più da segnare: una seduta passata conta come fatta, si segna solo l'assenza
-- - fisioterapisti aggiunti o tolti anche dalla segreteria (e da chi ne fa le veci)
-- - spia gialla: modifiche ai tabulati fatte da altri, con la spunta «Visto» personale
-- - svuotamento di pazienti e sedute (coordinatore / programmatore, con conferma scritta)
-- Si può eseguire più volte.
-- =====================================================================

-- Strumenti della segreteria: coordinatore, programmatore, segreteria e chi è autorizzato a farne le veci
create or replace function app.require_office() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_role('operatore');
  if app.my_role() = 'fisioterapista' then
    raise exception 'Operazione riservata alla segreteria e al coordinatore.' using errcode = '42501', hint = 'FA_PERM';
  end if;
end $$;

create or replace function public.admin_save_therapist(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.therapists; v_id uuid := nullif(p->>'id', '')::uuid; s jsonb;
begin
  perform app.require_office();
  if v_id is not null then
    select * into v from public.therapists where id = v_id for update;
    if not found then perform app.fail('Fisioterapista non trovato.'); end if;
    if v.version <> (p->>'version')::int then perform app.stale('La scheda del fisioterapista', v.updated_by); end if;
    update public.therapists set name = trim(p->>'name'), activity = p->>'activity', max_daily = nullif(p->>'max_daily', '')::int,
      active = coalesce((p->>'active')::boolean, true), note = coalesce(p->>'note', ''), sort = coalesce((p->>'sort')::int, sort)
    where id = v_id;
  else
    insert into public.therapists (name, activity, max_daily, active, note, sort)
    values (trim(p->>'name'), p->>'activity', nullif(p->>'max_daily', '')::int, coalesce((p->>'active')::boolean, true),
      coalesce(p->>'note', ''), coalesce((p->>'sort')::int, 100)) returning id into v_id;
  end if;
  if p ? 'skills' then
    delete from public.therapist_skills where therapist_id = v_id;
    for s in select * from jsonb_array_elements(p->'skills') loop
      insert into public.therapist_skills (therapist_id, category_id, level) values (v_id, s->>'category_id', s->>'level');
    end loop;
  end if;
  perform app.log('configurazione', 'Scheda di ' || trim(p->>'name') || ' ' || case when p ? 'id' then 'modificata' else 'creata' end || '.',
    'therapist', v_id::text, p);
  return v_id;
exception when check_violation or not_null_violation then
  raise exception 'Dati del fisioterapista incompleti o non validi.' using hint = 'FA_INPUT';
end $function$;

create or replace function public.appointment_issues(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(appointment_id uuid, kind text, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_role('lettura');
  return query
  select a.id,
         case when ab.id is not null then 'da_verificare' else 'conflitto' end,
         case when ab.id is not null
              then 'Rientro di ' || app.th_name(a.therapist_id) || ' non noto: sostituzioni organizzate fino al ' || app.fmt_d(ab.plan_until) || '. Verificare.'
              else m.msg end
    from public.appointments a
    cross join lateral (select app.check_slot(a.therapist_id, a.day, a.start_time, a.end_time, a.patient_id, a.id, a.cycle_id, false) as msg) m
    left join lateral (select x.id, x.plan_until from public.absences x
                        where x.therapist_id = a.therapist_id and not x.cancelled and x.end_date is null
                          and x.start_date <= a.day and x.plan_until < a.day
                          and (x.start_time is null or (x.start_time < a.end_time and a.start_time < x.end_time))
                        limit 1) ab on true
   where a.status in ('programmata', 'trattenuta')
     and a.day >= coalesce(p_from, app.today()) and a.day <= coalesce(p_to, app.today() + 120)
     and m.msg is not null
  union all
  select a.id, 'da_riprogrammare', coalesce(nullif(a.reason, ''), 'Da riprogrammare')
    from public.appointments a where a.status = 'da_riprogrammare'
  union all
  select a.id, 'recupero', 'Seduta da recuperare: recupero non ancora programmato.'
    from public.appointments a where a.status in ('assente', 'annullata') and a.to_recover and a.recovered_by is null;
end $function$;

-- Nuove attività scritte a mano: ambulatorio ortesi, gruppi, progetti (con un nome libero, campo «label»)
create or replace function app.validate_blocks(p jsonb, p_where text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare x jsonb; v_prev time; v_s time; v_e time;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception '%: fasce non valide.', p_where using hint = 'FA_INPUT'; end if;
  for x in select e from jsonb_array_elements(p) e order by (e->>'start')::time loop
    if coalesce(x->>'kind', '') not in ('amb', 'reparto', 'pausa', 'documentazione', 'segreteria', 'corso', 'permesso_ore', 'recupero_ore',
                                        'briefing', 'preparazione', 'ortesi', 'gruppo', 'progetto', 'altro') then
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
end $function$;

-- ---------------------------------------------------------------------
-- Spia gialla: modifiche ai tabulati fatte da altri, ancora da vedere
-- ---------------------------------------------------------------------
create table if not exists public.change_seen (
  user_id  uuid not null,
  audit_id bigint not null,
  at       timestamptz not null default now(),
  primary key (user_id, audit_id)
);
alter table public.change_seen enable row level security;
drop policy if exists propri on public.change_seen;
create policy propri on public.change_seen for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.change_seen from anon, authenticated;

create or replace function app.calendar_actions() returns text[] language sql immutable as $$
  select array['prenotazione', 'spostamento', 'sostituzione', 'scambio', 'eliminazione', 'annullamento', 'variazione', 'turno',
               'assenza', 'assenza_modificata', 'assenza_annullata', 'sospensione', 'ripresa', 'chiusura', 'modifica_ciclo',
               'cambio_stabile', 'da_riprogrammare', 'recupero', 'svuotamento']
$$;

create or replace function public.my_changes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.my_role() is null or app.my_role() not in ('programmatore', 'admin', 'operatore') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select l.id, l.at, l.user_name, l.action, l.summary, l.entity, l.entity_id
      from public.audit_log l
     where l.at > now() - interval '30 days' and l.action = any(app.calendar_actions())
       and l.user_id is distinct from auth.uid()
       and not exists (select 1 from public.change_seen s where s.user_id = auth.uid() and s.audit_id = l.id)
     order by l.id desc limit 200) x), '[]'::jsonb);
end $$;

-- spunta «Visto»: alcune voci, oppure tutte (p_ids null)
create or replace function public.mark_changes_seen(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform app.require_role('lettura');
  insert into public.change_seen (user_id, audit_id)
  select auth.uid(), l.id from public.audit_log l
   where (p_ids is null and l.at > now() - interval '30 days' and l.action = any(app.calendar_actions()) and l.user_id is distinct from auth.uid())
      or (p_ids is not null and l.id = any(p_ids))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Svuota pazienti e sedute (restano fisioterapisti, account, orari, ferie, storico)
-- ---------------------------------------------------------------------
create or replace function public.admin_clear_patients(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p int; v_a int;
begin
  perform app.require_role('admin');
  if coalesce(p_confirm, '') <> 'SVUOTA' then perform app.fail('Per confermare scrivi SVUOTA.'); end if;
  select count(*) into v_p from public.patients;
  select count(*) into v_a from public.appointments;
  perform set_config('app.restoring', 'on', true);
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
            where n.nspname = 'public' and p.proname in ('admin_save_therapist', 'appointment_issues', 'my_changes', 'mark_changes_seen', 'admin_clear_patients') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.require_office() from public, anon;
grant select on public.change_seen to authenticated;
