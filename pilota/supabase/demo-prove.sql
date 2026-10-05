-- =====================================================================
-- FisioAgenda — versione pilota: DATI FITTIZI SOLO PER LE PROVE AUTOMATICHE LOCALI.
-- NON eseguire sul progetto Supabase reale: lì i fisioterapisti e i pazienti si inseriscono dall'app.
-- 18 fisioterapisti e pazienti inventati; date calcolate rispetto a oggi.
-- Non viene eseguito se il database contiene già fisioterapisti.
-- Gli orari sono esempi modificabili per singolo collega.
-- =====================================================================
do $seed$
declare
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_base date;
  st record;
  v_th uuid;
  v_week jsonb;
  sl record;
  pat int[];
  v_pat uuid;
  v_cyc uuid;
  v_cat text;
  v_start date;
  v_d date;
  v_n int;
  v_k int;
  v_count int := 0;
  v_sessions int;
  v_status text;
  v_forecast text;
  v_slots jsonb;
  v_surn text[] := array['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Bruno','Marino','Gallo',
    'Giordano','Rizzo','Santoro','Mariani','Ferrara','Martini','Leone','Longo','Martinelli','Vitale','Lombardo','Coppola',
    'De Santis','D''Angelo','Marchetti','Parisi','Conte','Ferraro','Fabbri','Bianco','Grasso','Valentini','Messina','Sala',
    'De Angelis','Gatti','Pellegrini','Palumbo','Sanna','Farina','Rizzi','Monti','Cattaneo','Morelli','Amato','Silvestri'];
  v_init text[] := array['A','B','C','D','E','F','G','I','L','M','N','O','P','R','S','T','V'];
  v_prio text[] := array['U','B','B','D','D','D','P','P','NI'];
  v_skills text[];
  v_other text[];
begin
  if exists (select 1 from public.therapists) then
    raise notice 'Dati già presenti: nessun dato dimostrativo inserito.';
    return;
  end if;
  perform setseed(0.2026);
  v_base := v_today - ((extract(isodow from v_today)::int) - 1);   -- lunedì di questa settimana

  insert into public.categories (id, name, sort) values
    ('mano', 'Mano', 1), ('chir_mano', 'Chirurgia della mano / postoperatorio', 2),
    ('orto', 'Ortopedia post-chirurgica', 3), ('protesi', 'Protesi anca / ginocchio', 4), ('spalla', 'Spalla', 5),
    ('rachide', 'Rachide / lombalgia', 6), ('neuro', 'Neurologico', 7), ('onco', 'Oncologico', 8),
    ('linf', 'Linfedema', 9), ('pelv', 'Pavimento pelvico', 10), ('resp', 'Riabilitazione respiratoria', 11),
    ('ortesi', 'Ambulatorio ortesi', 12)
  on conflict (id) do nothing;

  -- festività nazionali (il Santo Patrono non è inserito) + una chiusura di esempio
  insert into public.closures (day, label) values
    ('2026-01-01','Capodanno'),('2026-01-06','Epifania'),('2026-04-06','Lunedì dell''Angelo'),('2026-04-25','Festa della Liberazione'),
    ('2026-05-01','Festa del Lavoro'),('2026-06-02','Festa della Repubblica'),('2026-08-15','Ferragosto'),('2026-11-01','Ognissanti'),
    ('2026-12-08','Immacolata Concezione'),('2026-12-25','Natale'),('2026-12-26','Santo Stefano'),
    ('2027-01-01','Capodanno'),('2027-01-06','Epifania'),('2027-03-29','Lunedì dell''Angelo'),('2027-04-25','Festa della Liberazione'),
    ('2027-05-01','Festa del Lavoro'),('2027-06-02','Festa della Repubblica'),('2027-08-15','Ferragosto'),('2027-11-01','Ognissanti'),
    ('2027-12-08','Immacolata Concezione'),('2027-12-25','Natale'),('2027-12-26','Santo Stefano')
  on conflict do nothing;
  insert into public.closures (day, label) values (v_base + 32, 'Chiusura straordinaria (esempio modificabile)') on conflict do nothing;

  for st in
    select * from (values
      (1,'Giulia Ferri','reparto7',array['neuro'],array['orto','rachide','protesi'],'std'),
      (2,'Marco Conti','reparto7',array['spalla','mano','chir_mano'],array['orto','protesi','rachide'],'std'),
      (3,'Sara Galli','reparto7',array['linf'],array['orto','rachide','mano','onco'],'std'),
      (4,'Luca Moretti','reparto7',array['rachide'],array['orto','protesi','spalla'],'no_mer'),
      (5,'Elena Rinaldi','reparto7',array['pelv'],array['rachide','orto'],'std'),
      (6,'Davide Marini','reparto7',array['protesi'],array['orto','spalla','rachide'],'std'),
      (7,'Chiara Lombardi','reparto7',array['resp'],array['neuro','orto','onco'],'std'),
      (8,'Paolo Greco','reparto7',array['orto'],array['protesi','spalla','rachide','mano','chir_mano'],'std'),
      (9,'Francesca Costa','reparto8',array['neuro','onco'],array['rachide'],'std'),
      (10,'Andrea Fontana','reparto8',array['spalla'],array['orto','protesi','mano'],'std'),
      (11,'Valentina Barbieri','reparto8',array['rachide'],array['orto','pelv'],'ven_corto'),
      (12,'Simone Caruso','reparto8',array['protesi'],array['orto','rachide'],'std'),
      (13,'Martina Gentile','reparto8',array['linf','onco'],array['orto','resp'],'std'),
      (14,'Matteo Ricci','reparto8',array['ortesi'],array['neuro','rachide','mano'],'std'),
      (15,'Laura De Luca','reparto8',array['orto','chir_mano'],array['protesi','spalla','rachide','mano','ortesi'],'std'),
      (16,'Roberto Mancini','reparto8',array['resp'],array['neuro'],'std'),
      (17,'Alessia Villa','ambulatorio',array['rachide','spalla','mano'],array['orto','protesi','chir_mano'],'std'),
      (18,'Federico Serra','ambulatorio',array['orto','protesi','ortesi'],array['rachide','spalla','mano'],'std')
    ) as t(ord, name, profile, spec, oth, variant)
  loop
    insert into public.therapists (name, activity, max_daily, sort, note)
    values (st.name, case when st.profile = 'ambulatorio' then 'ambulatorio' else 'ambulatorio_reparto' end,
            case when st.profile = 'ambulatorio' then 8 end, st.ord,
            case st.variant when 'no_mer' then 'Esempio: non in servizio il mercoledì' when 'ven_corto' then 'Esempio: venerdì solo mattina' else '' end)
    returning id into v_th;
    insert into public.therapist_skills (therapist_id, category_id, level)
      select v_th, c, 'specifica' from unnest(st.spec) c;
    insert into public.therapist_skills (therapist_id, category_id, level)
      select v_th, c, 'abilitato' from unnest(st.oth) c on conflict do nothing;

    v_week := case st.profile
      when 'reparto7' then jsonb_build_array(
        jsonb_build_object('kind','preparazione','start','07:00','end','07:15'),
        jsonb_build_object('kind','amb','start','07:15','end','09:00'),
        jsonb_build_object('kind','reparto','start','09:00','end','12:00'),
        jsonb_build_object('kind','pausa','start','12:00','end','12:20'),
        jsonb_build_object('kind','amb','start','12:20','end','13:20'),
        jsonb_build_object('kind','documentazione','start','13:20','end','14:12'))
      when 'reparto8' then jsonb_build_array(
        jsonb_build_object('kind','preparazione','start','08:00','end','08:15'),
        jsonb_build_object('kind','amb','start','08:15','end','09:00','max',1),
        jsonb_build_object('kind','reparto','start','09:00','end','12:20'),
        jsonb_build_object('kind','pausa','start','12:20','end','12:40'),
        jsonb_build_object('kind','amb','start','12:40','end','14:45'),
        jsonb_build_object('kind','documentazione','start','14:45','end','15:12'))
      else jsonb_build_array(
        jsonb_build_object('kind','preparazione','start','08:00','end','08:15'),
        jsonb_build_object('kind','amb','start','08:15','end','12:20'),
        jsonb_build_object('kind','pausa','start','12:20','end','12:40'),
        jsonb_build_object('kind','amb','start','12:40','end','14:40'),
        jsonb_build_object('kind','documentazione','start','14:40','end','15:12'))
      end;
    insert into public.shift_versions (therapist_id, valid_from, week, note)
    values (v_th, v_base - 63, jsonb_build_object(
      '1', v_week,
      '2', v_week,
      '3', case when st.variant = 'no_mer' then '[]'::jsonb else v_week end,
      '4', v_week,
      '5', case when st.variant = 'ven_corto' then jsonb_build_array(
              jsonb_build_object('kind','preparazione','start','08:00','end','08:15'),
              jsonb_build_object('kind','amb','start','08:15','end','12:00'),
              jsonb_build_object('kind','documentazione','start','12:00','end','12:30')) else v_week end,
      '6', '[]'::jsonb, '7', '[]'::jsonb), 'Turno iniziale (dati dimostrativi)');

    -- posti ricorrenti occupati da cicli fittizi
    v_slots := case st.profile
      when 'reparto7' then '[["07:15",30],["07:45",30],["08:15",45],["12:20",30],["12:50",30]]'::jsonb
      when 'reparto8' then '[["08:15",45],["12:40",30],["13:10",30],["13:40",30],["14:10",30]]'::jsonb
      else '[["08:15",30],["08:45",30],["09:15",45],["10:00",30],["11:00",30],["12:40",30],["13:10",30],["14:10",30]]'::jsonb
      end;
    for sl in select (x->>0)::time as s, (x->>1)::int as dur from jsonb_array_elements(v_slots) x loop
      foreach pat slice 1 in array array[array[1,3,5,0], array[2,4,0,0]] loop
        if random() > 0.62 then continue; end if;
        if st.variant = 'ven_corto' and sl.s >= '12:00' and pat[1] = 1 then continue; end if;
        v_count := v_count + 1;
        v_k := 1 + floor(random() * array_length(v_surn, 1))::int;
        insert into public.patients (name, note)
        values (v_surn[least(v_k, array_length(v_surn, 1))] || ' ' || v_init[1 + floor(random() * array_length(v_init, 1))::int] || '.', 'Paziente fittizio')
        returning id into v_pat;
        v_skills := st.spec; v_other := st.oth;
        v_cat := case when random() < 0.6 then v_skills[1 + floor(random() * array_length(v_skills, 1))::int]
                      else v_other[1 + floor(random() * array_length(v_other, 1))::int] end;
        v_sessions := case when random() < 0.8 then 10 when random() < 0.5 then 5 else 20 end;
        v_forecast := case when random() < 0.55 then 'da_valutare' when random() < 0.5 then 'conclusione_confermata'
                           when random() < 0.5 then 'probabile_conclusione' else 'prosecuzione' end;
        insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, weekdays,
          start_time, therapist_id, status, forecast)
        values (v_pat, v_cat, v_prio[1 + floor(random() * array_length(v_prio, 1))::int],
          case when random() < 0.8 then 'prima' else 'continuazione' end, sl.dur, v_sessions,
          array_remove(pat, 0), sl.s, v_th, 'attivo', v_forecast)
        returning id into v_cyc;
        -- inizio del ciclo: da 4 settimane fa a 1 settimana avanti
        v_start := v_base - 28 + floor(random() * 35)::int;
        v_d := v_start; v_n := 0;
        while v_n < v_sessions loop
          if extract(isodow from v_d)::int = any (pat) and not exists (select 1 from public.closures where day = v_d)
             and not (st.variant = 'no_mer' and extract(isodow from v_d) = 3) then
            v_status := case when v_d >= v_today then 'programmata'
                             when v_d = v_today - 1 and random() < 0.15 then 'programmata'  -- esito da registrare
                             when random() < 0.08 then 'assente' else 'effettuata' end;
            insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, status)
            values (v_cyc, v_pat, v_th, v_d, sl.s, sl.s + make_interval(mins => sl.dur), v_status);
            v_n := v_n + 1;
          end if;
          v_d := v_d + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  -- cicli conclusi: ultima seduta passata e conclusione confermata -> chiusi
  update public.cycles c set status = 'chiuso', closed_at = v_today, closed_reason = 'Ciclo completato'
   where c.forecast = 'conclusione_confermata'
     and not exists (select 1 from public.appointments a where a.cycle_id = c.id and a.day >= v_today);

  -- lista d'attesa (richieste non ancora prenotate)
  for v_k in 1..14 loop
    insert into public.patients (name, note)
    values (v_surn[1 + floor(random() * array_length(v_surn, 1))::int] || ' ' || v_init[1 + floor(random() * array_length(v_init, 1))::int] || '.', 'Paziente fittizio')
    returning id into v_pat;
    insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, weekdays, preference, created_at)
    values (v_pat, (array['mano','chir_mano','mano','orto','protesi','onco','ortesi','neuro','chir_mano','linf','spalla','rachide'])[1 + floor(random() * 12)::int],
      v_prio[1 + floor(random() * array_length(v_prio, 1))::int], case when random() < 0.75 then 'prima' else 'continuazione' end,
      case when random() < 0.8 then 30 else 45 end, (array[5,10,10,10,20,30])[1 + floor(random() * 6)::int],
      case when random() < 0.5 then '{1,3,5}'::int[] else '{2,4}'::int[] end,
      case when random() < 0.3 then 'Preferisce il primo pomeriggio' else '' end,
      now() - make_interval(days => floor(random() * 40)::int));
  end loop;

  -- ferie già note di una collega (esempio): gli appuntamenti coinvolti risultano da sistemare
  insert into public.absences (therapist_id, kind, start_date, end_date, note)
  select id, 'ferie', v_base + 14, v_base + 18, 'Esempio di ferie programmate' from public.therapists where name = 'Sara Galli';

  insert into public.audit_log (user_name, action, summary)
  values ('sistema', 'dati_demo', 'Inseriti i dati dimostrativi fittizi: 18 fisioterapisti, ' || v_count || ' cicli in corso, 14 richieste in lista d''attesa.');
end $seed$;
