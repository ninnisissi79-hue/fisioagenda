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
