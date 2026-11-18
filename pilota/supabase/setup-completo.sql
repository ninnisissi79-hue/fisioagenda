-- FisioAgenda pilota: installazione completa del database (generato da tools/build.mjs).
-- Da eseguire UNA SOLA VOLTA su un progetto Supabase nuovo: SQL Editor → incolla → Run.

-- >>> 20261005000001_schema.sql
-- =====================================================================
-- FisioAgenda — versione pilota condivisa
-- 1/2: tabelle, vincoli, funzioni di supporto, permessi (RLS), storico.
-- Solo dati fittizi. Nessuna password o chiave in questo file.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- Utenti: profilo e ruolo (gli account sono creati dal coordinatore
-- dal pannello di Supabase; la registrazione pubblica è disattivata)
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  full_name  text not null default '',
  role       text not null default 'lettura' check (role in ('admin', 'operatore', 'lettura')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ogni nuovo account parte in sola consultazione
create function app.on_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.on_new_user();

create function app.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create function app.is_reader() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.my_role() is not null
$$;

create function app.my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where user_id = auth.uid()
$$;

-- Controllo dei permessi lato server: ogni funzione che modifica i dati lo chiama.
create function app.require_role(p_min text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare r text := app.my_role();
begin
  if r is null then
    raise exception 'Accesso non autorizzato: account non riconosciuto o disattivato.' using errcode = '42501', hint = 'FA_AUTH';
  end if;
  if p_min = 'operatore' and r not in ('admin', 'operatore') then
    raise exception 'Permesso negato: il tuo profilo è di sola consultazione.' using errcode = '42501', hint = 'FA_PERM';
  end if;
  if p_min = 'admin' and r <> 'admin' then
    raise exception 'Permesso negato: operazione riservata al coordinatore.' using errcode = '42501', hint = 'FA_PERM';
  end if;
end $$;

create function app.today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- ---------------------------------------------------------------------
-- Configurazione del servizio
-- ---------------------------------------------------------------------
create table public.categories (
  id     text primary key,
  name   text not null,
  active boolean not null default true,
  sort   int not null default 0
);

create table public.therapists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  activity   text not null check (activity in ('ambulatorio', 'ambulatorio_reparto')),
  max_daily  int check (max_daily is null or max_daily between 1 and 30),
  active     boolean not null default true,
  note       text not null default '',
  sort       int not null default 0,
  version    int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- competenze: 'specifica' (proposto per primo) oppure 'abilitato'
create table public.therapist_skills (
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  category_id  text not null references public.categories(id) on delete cascade,
  level        text not null check (level in ('specifica', 'abilitato')),
  primary key (therapist_id, category_id)
);

-- Turno settimanale individuale con data di decorrenza. Le versioni non si cancellano:
-- la versione valida per un giorno è quella con la decorrenza più recente non successiva.
-- week = {"1":[{"kind":"amb","start":"08:15","end":"12:20","max":null}, ...], ..., "7":[]}
-- kind: amb (ambulatorio, prenotabile) | reparto | pausa | documentazione | preparazione | altro
create table public.shift_versions (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  valid_from   date not null,
  week         jsonb not null,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (therapist_id, valid_from)
);

-- Variazione di una singola giornata: sostituisce le fasce del turno per quel giorno.
create table public.day_overrides (
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  day          date not null,
  blocks       jsonb not null,
  note         text not null default '',
  version      int not null default 1,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (therapist_id, day)
);

create table public.closures (
  day   date primary key,
  label text not null
);

-- Assenze dei fisioterapisti. end_date null = rientro non noto (serve plan_until).
-- start_time/end_time null = giornata intera. Annullare un'assenza la conserva (cancelled).
create table public.absences (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  kind         text not null default 'malattia' check (kind in ('malattia', 'ferie', 'permesso', 'formazione', 'altro')),
  start_date   date not null,
  end_date     date,
  start_time   time,
  end_time     time,
  plan_until   date,
  note         text not null default '',
  cancelled    boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  version      int not null default 1,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  check (end_date is null or end_date >= start_date),
  check ((start_time is null) = (end_time is null)),
  check (start_time is null or end_time > start_time),
  check (end_date is not null or plan_until is not null),
  check (plan_until is null or plan_until >= start_date)
);

-- ---------------------------------------------------------------------
-- Pazienti (solo fittizi), cicli e appuntamenti
-- ---------------------------------------------------------------------
create table public.patients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  note       text not null default '',
  created_at timestamptz not null default now(),
  version    int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.cycles (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,
  category_id       text not null references public.categories(id),
  priority          text not null default 'NI' check (priority in ('U', 'B', 'D', 'P', 'NI')),
  request_type      text not null default 'prima' check (request_type in ('prima', 'continuazione')),
  duration          int not null check (duration in (30, 45)),
  planned_sessions  int not null check (planned_sessions in (5, 10, 20, 30)),
  weekdays          int[] not null default '{}',
  start_time        time,
  therapist_id      uuid references public.therapists(id),
  status            text not null default 'in_attesa' check (status in ('in_attesa', 'attivo', 'sospeso', 'chiuso')),
  forecast          text not null default 'da_valutare'
                    check (forecast in ('da_valutare', 'prosecuzione', 'probabile_conclusione', 'conclusione_confermata')),
  suspension_reason text check (suspension_reason in ('ticket', 'clinico', 'paziente', 'altro')),
  suspension_note   text not null default '',
  suspension_keep   boolean,
  review_date       date,
  suspended_from    date,
  closed_reason     text not null default '',
  closed_at         date,
  preference        text not null default '',
  note              text not null default '',
  created_at        timestamptz not null default now(),
  created_by        uuid,
  version           int not null default 1,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

-- Stati della seduta:
--   programmata      prenotata (occupa il posto)
--   effettuata       svolta (occupa il posto; è l'unica che conta come trattamento svolto)
--   assente          assenza del paziente (non occupa; to_recover = da recuperare)
--   annullata        annullata dal paziente o dal servizio (non occupa)
--   da_riprogrammare senza posto (es. fisioterapista assente senza sostituto): motivo in reason
--   trattenuta       ciclo sospeso con posto mantenuto (occupa il posto)
--   liberata         posto liberato (sospensione o chiusura anticipata), conservata come traccia
--   spostata         sostituita da un nuovo appuntamento (modifica del ciclo), conservata come traccia
create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  cycle_id              uuid not null references public.cycles(id) on delete cascade,
  patient_id            uuid not null references public.patients(id) on delete cascade,
  therapist_id          uuid not null references public.therapists(id),
  day                   date not null,
  start_time            time not null,
  end_time              time not null,
  status                text not null default 'programmata'
                        check (status in ('programmata', 'effettuata', 'assente', 'annullata', 'da_riprogrammare', 'trattenuta', 'liberata', 'spostata')),
  to_recover            boolean not null default false,
  recovery_of           uuid references public.appointments(id) on delete set null,
  recovered_by          uuid references public.appointments(id) on delete set null,
  cancel_by             text check (cancel_by in ('paziente', 'servizio')),
  substitute_kind       text check (substitute_kind in ('singola', 'periodo', 'stabile')),
  original_therapist_id uuid references public.therapists(id),
  freed_for             text check (freed_for in ('sospensione', 'chiusura')),
  reason                text not null default '',
  note                  text not null default '',
  slot                  tsrange generated always as (tsrange(day + start_time, day + end_time, '[)')) stored,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  version               int not null default 1,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  check (end_time > start_time),
  -- prevenzione delle doppie prenotazioni, garantita dal database anche con conferme simultanee
  constraint no_double_booking exclude using gist (therapist_id with =, slot with &&)
    where (status in ('programmata', 'effettuata', 'trattenuta')),
  constraint no_patient_overlap exclude using gist (patient_id with =, slot with &&)
    where (status in ('programmata', 'effettuata', 'trattenuta'))
);
create index appointments_day_idx on public.appointments (day);
create index appointments_cycle_idx on public.appointments (cycle_id);
create index appointments_th_day_idx on public.appointments (therapist_id, day);
create index cycles_patient_idx on public.cycles (patient_id);
create index absences_th_idx on public.absences (therapist_id);

-- ---------------------------------------------------------------------
-- Storico: registro leggibile (azioni) + registro tecnico delle righe
-- ---------------------------------------------------------------------
create table public.audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   uuid,
  user_name text not null default '',
  action    text not null,
  summary   text not null,
  entity    text,
  entity_id text,
  details   jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.row_changes (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   uuid,
  tbl       text not null,
  op        text not null,
  row_id    text,
  old_row   jsonb,
  new_row   jsonb
);
create index row_changes_at_idx on public.row_changes (at desc);

create function app.log(p_action text, p_summary text, p_entity text default null, p_entity_id text default null, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (user_id, user_name, action, summary, entity, entity_id, details)
  values (auth.uid(), coalesce(app.my_name(), 'sistema'), p_action, p_summary, p_entity, p_entity_id, p_details);
end $$;

create function app.track_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  -- durante il ripristino da backup il registro tecnico non duplica ogni riga
  if current_setting('app.restoring', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'user_id', to_jsonb(old)->>'therapist_id', to_jsonb(old)->>'day');
    insert into public.row_changes (user_id, tbl, op, row_id, old_row) values (auth.uid(), tg_table_name, tg_op, v_id, to_jsonb(old));
    return old;
  end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id', to_jsonb(new)->>'therapist_id', to_jsonb(new)->>'day');
  insert into public.row_changes (user_id, tbl, op, row_id, old_row, new_row)
  values (auth.uid(), tg_table_name, tg_op, v_id, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

-- versione per il controllo delle modifiche contemporanee + chi/quando
create function app.touch() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['therapists', 'day_overrides', 'absences', 'patients', 'cycles', 'appointments'] loop
    execute format('create trigger touch before update on public.%I for each row execute function app.touch()', t);
  end loop;
  foreach t in array array['profiles', 'categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides',
                           'closures', 'absences', 'patients', 'cycles', 'appointments'] loop
    execute format('create trigger track after insert or update or delete on public.%I for each row execute function app.track_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permessi sulle tabelle (RLS): lettura per gli utenti attivi.
-- Nessuna scrittura diretta: tutte le modifiche passano dalle funzioni
-- del server, che verificano ruolo, versioni e vincoli.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides', 'closures',
                           'absences', 'patients', 'cycles', 'appointments', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy lettura on public.%I for select to authenticated using (app.is_reader())', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
-- ognuno vede il proprio profilo; l'elenco completo (email dei colleghi) solo il coordinatore
create policy lettura on public.profiles for select to authenticated
  using (user_id = auth.uid() or app.my_role() = 'admin');
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;

-- registro tecnico: solo coordinatore
alter table public.row_changes enable row level security;
create policy lettura on public.row_changes for select to authenticated using (app.my_role() = 'admin');
revoke insert, update, delete, truncate on public.row_changes from anon, authenticated;
revoke all on public.row_changes from anon;

revoke all on all functions in schema app from public, anon;
grant execute on function app.my_role(), app.is_reader() to authenticated;

-- ---------------------------------------------------------------------
-- Aggiornamento in tempo reale per gli altri colleghi
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.therapists, public.therapist_skills, public.shift_versions,
      public.day_overrides, public.closures, public.absences, public.patients, public.cycles, public.appointments,
      public.categories, public.audit_log;
  end if;
end $$;
alter table public.appointments replica identity full;
alter table public.therapist_skills replica identity full;
alter table public.day_overrides replica identity full;
alter table public.closures replica identity full;


-- >>> 20261005000002_functions.sql
-- =====================================================================
-- FisioAgenda — versione pilota condivisa
-- 2/2: regole del servizio e operazioni (funzioni del server).
-- Ogni operazione: verifica il ruolo, controlla la versione dei dati
-- (modifiche contemporanee), ricontrolla i vincoli sul database e scrive
-- lo storico. Le prenotazioni sullo stesso fisioterapista sono serializzate.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Supporto
-- ---------------------------------------------------------------------
create function app.fmt_d(d date) returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;
create function app.fmt_t(t time) returns text language sql immutable as $$ select to_char(t, 'HH24:MI') $$;

create function app.block_label(k text) returns text language sql immutable as $$
  select case k when 'amb' then 'ambulatorio' when 'reparto' then 'reparto' when 'pausa' then 'pausa'
    when 'documentazione' then 'documentazione' when 'preparazione' then 'preparazione' else 'altra attività' end
$$;

create function app.forecast_label(f text) returns text language sql immutable as $$
  select case f when 'da_valutare' then 'da valutare' when 'prosecuzione' then 'prosecuzione prevista'
    when 'probabile_conclusione' then 'probabile conclusione' when 'conclusione_confermata' then 'conclusione confermata' else f end
$$;

create function app.th_name(p uuid) returns text language sql stable security definer set search_path = '' as $$
  select name from public.therapists where id = p
$$;

create function app.user_label(p uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where user_id = p
$$;

create function app.fail(p_msg text, p_code text default 'FA_INPUT') returns void
language plpgsql as $$
begin
  raise exception '%', p_msg using hint = p_code;
end $$;

-- modifica contemporanea: i dati letti dall'utente non sono più quelli attuali
create function app.stale(p_what text, p_by uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  raise exception '% è stato modificato nel frattempo da %. I dati sono stati aggiornati: controlla e riprova.',
    p_what, coalesce(app.user_label(p_by), 'un altro utente') using hint = 'FA_CONFLICT';
end $$;

-- serializza le prenotazioni dello stesso fisioterapista (conferme simultanee)
create function app.lock_th(p uuid) returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended('fisioagenda-th:' || p::text, 0))
$$;

-- Fasce della giornata: variazione giornaliera se presente, altrimenti turno in vigore quel giorno.
create function app.day_blocks(p_th uuid, p_day date)
returns table (kind text, s time, e time, maxp int)
language sql stable security definer set search_path = '' as $$
  with src as (
    select coalesce(
      (select o.blocks from public.day_overrides o where o.therapist_id = p_th and o.day = p_day),
      (select v.week -> (extract(isodow from p_day)::int)::text from public.shift_versions v
        where v.therapist_id = p_th and v.valid_from <= p_day order by v.valid_from desc limit 1)
    ) as blocks
  )
  select x->>'kind', (x->>'start')::time, (x->>'end')::time, nullif(x->>'max', '')::int
  from src, jsonb_array_elements(coalesce(src.blocks, '[]'::jsonb)) x
  order by 2
$$;

-- Controllo completo di un posto. Restituisce null se il posto è utilizzabile,
-- altrimenti il motivo in italiano. È la regola di riferimento: l'interfaccia
-- propone, il server decide.
create function app.check_slot(p_th uuid, p_day date, p_start time, p_end time,
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
       and c.start_time < p_end and p_start < (c.start_time + make_interval(mins => c.duration))
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

create function app.require_skill(p_th uuid, p_cat text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.therapist_skills where therapist_id = p_th and category_id = p_cat) then
    perform app.fail(coalesce(app.th_name(p_th), 'Il fisioterapista') || ' non è abilitato al percorso ' ||
      coalesce((select name from public.categories where id = p_cat), p_cat) || '.', 'FA_SLOT');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Lettura: utente corrente e attività da sistemare
-- ---------------------------------------------------------------------
create function public.whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where user_id = auth.uid();
  if not found then return jsonb_build_object('role', null, 'today', app.today()); end if;
  return jsonb_build_object('user_id', v.user_id, 'email', v.email, 'full_name', v.full_name,
    'role', case when v.active then v.role end, 'active', v.active, 'today', app.today(), 'now', now());
end $$;

-- Appuntamenti da sistemare, ricalcolati sul server con le regole di riferimento.
create function public.appointment_issues(p_from date default null, p_to date default null)
returns table (appointment_id uuid, kind text, message text)
language plpgsql stable security definer set search_path = '' as $$
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
  select a.id, 'esito_mancante', 'Seduta passata senza esito registrato.'
    from public.appointments a where a.status = 'programmata' and a.day < app.today() and a.day >= app.today() - 30
  union all
  select a.id, 'recupero', 'Seduta da recuperare: recupero non ancora programmato.'
    from public.appointments a where a.status in ('assente', 'annullata') and a.to_recover and a.recovered_by is null;
end $$;

-- ---------------------------------------------------------------------
-- Pazienti e richieste (lista d'attesa)
-- ---------------------------------------------------------------------
create function public.create_request(p jsonb) returns jsonb
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
  insert into public.cycles (patient_id, category_id, priority, request_type, duration, planned_sessions, weekdays, preference, note, created_by)
  values (v_pat, p->>'category_id', coalesce(p->>'priority', 'NI'), coalesce(p->>'request_type', 'prima'),
          coalesce((p->>'duration')::int, 30), coalesce((p->>'planned_sessions')::int, 10),
          coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{}'),
          coalesce(p->>'preference', ''), coalesce(p->>'note', ''), auth.uid())
  returning id into v_cyc;
  perform app.log('richiesta', 'Nuova richiesta per ' || v_name || ' inserita in lista d''attesa.', 'cycle', v_cyc::text, p);
  return jsonb_build_object('patient_id', v_pat, 'cycle_id', v_cyc);
end $$;

create function public.update_patient(p_id uuid, p_version int, p_name text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.patients;
begin
  perform app.require_role('operatore');
  select * into v from public.patients where id = p_id for update;
  if not found then perform app.fail('Paziente non trovato.'); end if;
  if v.version <> p_version then perform app.stale('Il paziente', v.updated_by); end if;
  if trim(coalesce(p_name, '')) = '' then perform app.fail('Il nome non può essere vuoto.'); end if;
  update public.patients set name = trim(p_name), note = coalesce(p_note, '') where id = p_id;
  perform app.log('paziente', 'Dati del paziente ' || trim(p_name) || ' modificati.', 'patient', p_id::text, null);
end $$;

-- priorità, tipo di richiesta, previsione, preferenze: non toccano gli appuntamenti
create function public.update_cycle_info(p_cycle uuid, p_version int, p jsonb) returns void
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
    category_id = case when status = 'in_attesa' then coalesce(p->>'category_id', category_id) else category_id end,
    weekdays = case when status = 'in_attesa' and p ? 'weekdays'
                    then coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'weekdays') x), '{}')
                    else weekdays end
  where id = p_cycle;
  perform app.log('ciclo', 'Dati del ciclo di ' || (select name from public.patients where id = c.patient_id) || ' modificati.',
    'cycle', p_cycle::text, p);
end $$;

-- ---------------------------------------------------------------------
-- Prenotazione di un ciclo (stesso fisioterapista e stesso orario)
-- ---------------------------------------------------------------------
create function public.book_cycle(p_cycle uuid, p_version int, p_therapist uuid, p_start time, p_weekdays int[], p_dates date[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_d date; v_msg text; v_end time; v_n int := 0; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Richiesta non trovata.'); end if;
  if c.version <> p_version then perform app.stale('La richiesta', c.updated_by); end if;
  if c.status <> 'in_attesa' then perform app.fail('Il ciclo è già stato prenotato.', 'FA_CONFLICT'); end if;
  if coalesce(array_length(p_dates, 1), 0) <> c.planned_sessions then
    perform app.fail('Servono ' || c.planned_sessions || ' date, ne sono state indicate ' || coalesce(array_length(p_dates, 1), 0) || '.');
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

-- ---------------------------------------------------------------------
-- Sostituzioni (assenza del fisioterapista): ogni voce è salvata o
-- rifiutata singolarmente, con il motivo.
-- items: [{appointment_id, version, action: 'sostituisci'|'da_riprogrammare',
--          therapist_id, day, start_time, kind: 'singola'|'periodo', reason}]
-- ---------------------------------------------------------------------
create function public.apply_substitutions(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; a public.appointments; c public.cycles; v_res jsonb := '[]'::jsonb;
  v_th uuid; v_day date; v_start time; v_end time; v_msg text; v_pname text; v_kind text;
begin
  perform app.require_role('operatore');
  -- blocchi in ordine fisso per evitare attese incrociate
  perform app.lock_th(x) from (select distinct (e->>'therapist_id')::uuid x from jsonb_array_elements(p_items) e
                               where nullif(e->>'therapist_id', '') is not null order by 1) s;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      select * into a from public.appointments where id = (it->>'appointment_id')::uuid for update;
      if not found then perform app.fail('Appuntamento non trovato.'); end if;
      select name into v_pname from public.patients where id = a.patient_id;
      if a.version <> (it->>'version')::int then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
      if a.status not in ('programmata', 'da_riprogrammare') then
        perform app.fail('L''appuntamento di ' || v_pname || ' non è più da sistemare (stato: ' || a.status || ').', 'FA_CONFLICT');
      end if;
      select * into c from public.cycles where id = a.cycle_id;
      if it->>'action' = 'da_riprogrammare' then
        update public.appointments set status = 'da_riprogrammare',
          reason = coalesce(nullif(it->>'reason', ''), 'Nessun sostituto compatibile.') where id = a.id;
        perform app.log('da_riprogrammare', v_pname || ' (' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ') lasciato da riprogrammare: '
          || coalesce(nullif(it->>'reason', ''), 'nessun sostituto compatibile') || '.', 'appointment', a.id::text, it);
        v_res := v_res || jsonb_build_object('appointment_id', a.id, 'ok', true);
      else
        v_th := (it->>'therapist_id')::uuid;
        v_day := coalesce(nullif(it->>'day', '')::date, a.day);
        v_start := coalesce(nullif(it->>'start_time', '')::time, a.start_time);
        v_end := v_start + (a.end_time - a.start_time);
        v_kind := coalesce(nullif(it->>'kind', ''), 'singola');
        if v_kind not in ('singola', 'periodo') then perform app.fail('Tipo di sostituzione non valido.'); end if;
        if v_day < app.today() then perform app.fail('La data ' || app.fmt_d(v_day) || ' è già passata.'); end if;
        perform app.require_skill(v_th, c.category_id);
        v_msg := app.check_slot(v_th, v_day, v_start, v_end, a.patient_id, a.id, a.cycle_id, true);
        if v_msg is not null then perform app.fail(v_msg, 'FA_SLOT'); end if;
        update public.appointments set therapist_id = v_th, day = v_day, start_time = v_start, end_time = v_end,
          status = 'programmata', reason = '',
          substitute_kind = case when v_th = c.therapist_id then null else v_kind end,
          original_therapist_id = case when v_th = c.therapist_id then null else coalesce(a.original_therapist_id, a.therapist_id) end
        where id = a.id;
        perform app.log('sostituzione', v_pname || ': seduta del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time)
          || ' affidata a ' || app.th_name(v_th) || case when v_day <> a.day or v_start <> a.start_time
             then ' con cambio di orario (' || app.fmt_d(v_day) || ' ' || app.fmt_t(v_start) || ')' else ' allo stesso orario' end
          || ' — sostituzione ' || case v_kind when 'periodo' then 'per un periodo' else 'per una singola seduta' end || '.',
          'appointment', a.id::text, it);
        v_res := v_res || jsonb_build_object('appointment_id', a.id, 'ok', true);
      end if;
    exception
      when exclusion_violation then
        v_res := v_res || jsonb_build_object('appointment_id', it->>'appointment_id', 'ok', false,
          'message', 'Il posto è stato appena occupato da un altro utente.');
      when others then
        if sqlstate = '42501' then raise; end if;
        v_res := v_res || jsonb_build_object('appointment_id', it->>'appointment_id', 'ok', false, 'message', sqlerrm);
    end;
  end loop;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- Singola seduta: spostamento (giorno, ora, fisioterapista)
-- ---------------------------------------------------------------------
create function public.move_appointment(p_id uuid, p_version int, p_therapist uuid, p_day date, p_start time, p_note text default '')
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
  if p_day < app.today() then perform app.fail('Non si può spostare una seduta in una data passata.'); end if;
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

-- ---------------------------------------------------------------------
-- Ciclo: modifica degli appuntamenti futuri da una data scelta
-- (nuovo orario, giorni o fisioterapista). Le sedute sostituite restano
-- come traccia ("spostata"). Tutto o niente.
-- ---------------------------------------------------------------------
create function public.reschedule_cycle(p_cycle uuid, p_version int, p_from date, p_therapist uuid, p_start time,
  p_weekdays int[], p_dates date[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_old int; v_d date; v_end time; v_msg text; v_pname text; v_n int := 0;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status <> 'attivo' then perform app.fail('Si possono modificare solo cicli attivi.'); end if;
  if p_from < app.today() then perform app.fail('La data di inizio della modifica non può essere passata.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  if c.therapist_id is not null then perform app.lock_th(c.therapist_id); end if;
  select count(*) into v_old from public.appointments
   where cycle_id = c.id and status = 'programmata' and day >= p_from and recovery_of is null;
  if v_old = 0 then perform app.fail('Nessuna seduta programmata da modificare dal ' || app.fmt_d(p_from) || '.'); end if;
  if coalesce(array_length(p_dates, 1), 0) <> v_old then
    perform app.fail('Le nuove date (' || coalesce(array_length(p_dates, 1), 0) || ') devono essere tante quante le sedute da spostare (' || v_old || ').');
  end if;
  update public.appointments set status = 'spostata', reason = 'Ciclo modificato dal ' || app.fmt_d(p_from)
   where cycle_id = c.id and status = 'programmata' and day >= p_from and recovery_of is null;
  v_end := p_start + make_interval(mins => c.duration);
  foreach v_d in array (select array_agg(d order by d) from unnest(p_dates) d) loop
    if v_d < p_from then perform app.fail('La data ' || app.fmt_d(v_d) || ' precede la decorrenza della modifica.'); end if;
    v_msg := app.check_slot(p_therapist, v_d, p_start, v_end, c.patient_id, null, c.id, true);
    if v_msg is not null then perform app.fail('Seduta del ' || app.fmt_d(v_d) || ': ' || v_msg, 'FA_SLOT'); end if;
    insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, created_by)
    values (c.id, c.patient_id, p_therapist, v_d, p_start, v_end, auth.uid());
    v_n := v_n + 1;
  end loop;
  update public.cycles set therapist_id = p_therapist, start_time = p_start, weekdays = coalesce(p_weekdays, weekdays) where id = c.id;
  perform app.log(case when p_therapist <> c.therapist_id then 'cambio_stabile' else 'modifica_ciclo' end,
    v_pname || ': ' || v_n || ' sedute dal ' || app.fmt_d(p_from) || ' riprogrammate'
    || case when p_therapist <> c.therapist_id then ' — cambio stabile del fisioterapista da ' || app.th_name(c.therapist_id) || ' a ' || app.th_name(p_therapist)
       else ' con ' || app.th_name(p_therapist) end || ' alle ' || app.fmt_t(p_start) || '.', 'cycle', c.id::text,
    jsonb_build_object('from', p_from, 'therapist_id', p_therapist, 'start', p_start, 'dates', p_dates));
  return jsonb_build_object('moved', v_n);
exception when exclusion_violation then
  raise exception 'Uno dei posti è stato appena occupato da un altro utente. Nessuna modifica è stata salvata.' using hint = 'FA_SLOT';
end $$;

-- ---------------------------------------------------------------------
-- Esito della seduta: effettuata, assenza del paziente, annullamento
-- (con eventuale recupero). Una seduta non svolta non conta come trattamento.
-- ---------------------------------------------------------------------
create function public.register_outcome(p_id uuid, p_version int, p_status text, p_cancel_by text default null,
  p_to_recover boolean default false, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_msg text; v_pname text;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_id for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if p_status not in ('effettuata', 'assente', 'annullata', 'programmata') then perform app.fail('Esito non valido.'); end if;
  if a.status not in ('programmata', 'effettuata', 'assente', 'annullata', 'da_riprogrammare') then
    perform app.fail('Lo stato attuale della seduta non consente questa modifica.');
  end if;
  if a.recovered_by is not null and p_status <> a.status then
    perform app.fail('Per questa seduta è già stato programmato un recupero: modifica prima il recupero.');
  end if;
  if p_status = 'effettuata' and a.day > app.today() then perform app.fail('Una seduta futura non può essere registrata come effettuata.'); end if;
  if p_status = 'effettuata' and a.status = 'da_riprogrammare' then perform app.fail('Prima riprogramma la seduta.'); end if;
  if p_status = 'annullata' and coalesce(p_cancel_by, '') not in ('paziente', 'servizio') then
    perform app.fail('Indica se l''annullamento è del paziente o del servizio.');
  end if;
  if p_status = 'programmata' then
    perform app.lock_th(a.therapist_id);
    v_msg := app.check_slot(a.therapist_id, a.day, a.start_time, a.end_time, a.patient_id, a.id, a.cycle_id, false);
    if v_msg is not null then perform app.fail('Non si può ripristinare la seduta: ' || v_msg, 'FA_SLOT'); end if;
  end if;
  update public.appointments set status = p_status,
    cancel_by = case when p_status = 'annullata' then p_cancel_by end,
    to_recover = case when p_status in ('assente', 'annullata') then coalesce(p_to_recover, false) else false end,
    note = coalesce(nullif(p_note, ''), note)
  where id = a.id;
  perform app.log('esito', v_pname || ', seduta del ' || app.fmt_d(a.day) || ' ' || app.fmt_t(a.start_time) || ': '
    || case p_status when 'effettuata' then 'effettuata' when 'assente' then 'assenza del paziente'
         when 'annullata' then 'annullata dal ' || p_cancel_by else 'riportata a programmata' end
    || case when p_status in ('assente', 'annullata') and p_to_recover then ' — da recuperare' else '' end || '.',
    'appointment', a.id::text, null);
exception when exclusion_violation then
  raise exception 'Il posto è stato nel frattempo occupato da un altro appuntamento.' using hint = 'FA_SLOT';
end $$;

create function public.book_recovery(p_orig uuid, p_version int, p_therapist uuid, p_day date, p_start time)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.appointments; c public.cycles; v_end time; v_msg text; v_new uuid; v_pname text;
begin
  perform app.require_role('operatore');
  select * into a from public.appointments where id = p_orig for update;
  if not found then perform app.fail('Appuntamento non trovato.'); end if;
  select name into v_pname from public.patients where id = a.patient_id;
  if a.version <> p_version then perform app.stale('L''appuntamento di ' || v_pname, a.updated_by); end if;
  if a.status not in ('assente', 'annullata') or not a.to_recover then perform app.fail('La seduta non è segnata da recuperare.'); end if;
  if a.recovered_by is not null then perform app.fail('Il recupero è già stato programmato.', 'FA_CONFLICT'); end if;
  if p_day < app.today() then perform app.fail('La data del recupero è già passata.'); end if;
  select * into c from public.cycles where id = a.cycle_id;
  if c.status <> 'attivo' then perform app.fail('Il ciclo non è attivo.'); end if;
  perform app.require_skill(p_therapist, c.category_id);
  perform app.lock_th(p_therapist);
  v_end := p_start + (a.end_time - a.start_time);
  v_msg := app.check_slot(p_therapist, p_day, p_start, v_end, a.patient_id, null, a.cycle_id, true);
  if v_msg is not null then perform app.fail(v_msg, 'FA_SLOT'); end if;
  insert into public.appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time, recovery_of, created_by,
    substitute_kind, original_therapist_id)
  values (a.cycle_id, a.patient_id, p_therapist, p_day, p_start, v_end, a.id, auth.uid(),
    case when p_therapist = c.therapist_id then null else 'singola' end,
    case when p_therapist = c.therapist_id then null else c.therapist_id end)
  returning id into v_new;
  update public.appointments set recovered_by = v_new where id = a.id;
  perform app.log('recupero', v_pname || ': recupero della seduta del ' || app.fmt_d(a.day) || ' programmato il ' || app.fmt_d(p_day)
    || ' alle ' || app.fmt_t(p_start) || ' con ' || app.th_name(p_therapist) || '.', 'appointment', v_new::text, null);
  return v_new;
exception when exclusion_violation then
  raise exception 'Il posto è stato appena occupato da un altro utente.' using hint = 'FA_SLOT';
end $$;

-- ---------------------------------------------------------------------
-- Sospensione, ripresa, chiusura anticipata
-- ---------------------------------------------------------------------
create function public.suspend_cycle(p_cycle uuid, p_version int, p_reason text, p_note text, p_keep boolean,
  p_review date, p_from date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cycles; v_n int; v_pname text;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status <> 'attivo' then perform app.fail('Si può sospendere solo un ciclo attivo.'); end if;
  if p_reason not in ('ticket', 'clinico', 'paziente', 'altro') then perform app.fail('Scegli il motivo della sospensione.'); end if;
  if p_reason = 'altro' and trim(coalesce(p_note, '')) = '' then perform app.fail('Descrivi il motivo della sospensione.'); end if;
  if p_keep is null then perform app.fail('Indica se mantenere o liberare i posti futuri.'); end if;
  if p_keep and p_review is null then perform app.fail('Per mantenere i posti indica la data di rivalutazione.'); end if;
  if p_from < app.today() then perform app.fail('La sospensione non può iniziare in una data passata.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  if p_keep then
    update public.appointments set status = 'trattenuta', reason = 'Ciclo sospeso: posto mantenuto'
     where cycle_id = c.id and status = 'programmata' and day >= p_from;
  else
    update public.appointments set status = 'liberata', freed_for = 'sospensione', reason = 'Ciclo sospeso: posto liberato'
     where cycle_id = c.id and status = 'programmata' and day >= p_from;
  end if;
  get diagnostics v_n = row_count;
  update public.cycles set status = 'sospeso', suspension_reason = p_reason, suspension_note = coalesce(p_note, ''),
    suspension_keep = p_keep, review_date = p_review, suspended_from = p_from where id = c.id;
  perform app.log('sospensione', 'Ciclo di ' || v_pname || ' sospeso dal ' || app.fmt_d(p_from) || ' (motivo: '
    || case p_reason when 'ticket' then 'ticket non regolarizzato' when 'clinico' then 'motivo clinico'
         when 'paziente' then 'indisponibilità del paziente' else 'altro: ' || p_note end || '). '
    || v_n || ' appuntamenti futuri ' || case when p_keep then 'mantenuti fino alla rivalutazione del ' || app.fmt_d(p_review) else 'liberati' end || '.',
    'cycle', c.id::text, jsonb_build_object('keep', p_keep, 'review', p_review, 'from', p_from));
  return jsonb_build_object('changed', v_n);
end $$;

-- Ripresa: i posti mantenuti tornano programmati; i posti liberati sono
-- ripristinati solo se ancora compatibili, gli altri restano "da riprogrammare".
-- p_dry_run = true mostra l'effetto senza salvare.
create function public.resume_cycle(p_cycle uuid, p_version int, p_from date, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycles; a record; v_msg text; v_plan jsonb := '[]'::jsonb; v_pname text; v_ok int := 0; v_ko int := 0;
begin
  perform app.require_role('operatore');
  select * into c from public.cycles where id = p_cycle for update;
  if not found then perform app.fail('Ciclo non trovato.'); end if;
  if c.version <> p_version then perform app.stale('Il ciclo', c.updated_by); end if;
  if c.status <> 'sospeso' then perform app.fail('Il ciclo non è sospeso.'); end if;
  if p_from < app.today() then perform app.fail('La ripresa non può essere in una data passata.'); end if;
  select name into v_pname from public.patients where id = c.patient_id;
  if c.therapist_id is not null then perform app.lock_th(c.therapist_id); end if;
  begin
    -- sedute trattenute durante la sospensione e ormai passate: non svolte
    update public.appointments set status = 'liberata', freed_for = 'sospensione', reason = 'Non svolta: ciclo sospeso'
     where cycle_id = c.id and status = 'trattenuta' and day < p_from;
    for a in select * from public.appointments
              where cycle_id = c.id and day >= p_from
                and (status = 'trattenuta' or (status = 'liberata' and freed_for = 'sospensione'))
              order by day, start_time loop
      perform app.lock_th(a.therapist_id);
      v_msg := app.check_slot(a.therapist_id, a.day, a.start_time, a.end_time, a.patient_id, a.id, a.cycle_id, false);
      if v_msg is null then
        update public.appointments set status = 'programmata', reason = '', freed_for = null where id = a.id;
        v_ok := v_ok + 1;
      else
        update public.appointments set status = 'da_riprogrammare', freed_for = null,
          reason = 'Non ripristinabile alla ripresa: ' || v_msg where id = a.id;
        v_ko := v_ko + 1;
      end if;
      v_plan := v_plan || jsonb_build_object('appointment_id', a.id, 'day', a.day, 'start_time', a.start_time,
        'therapist_id', a.therapist_id, 'was', a.status, 'ok', v_msg is null, 'message', v_msg);
    end loop;
    if p_dry_run then raise exception using errcode = 'P0099', message = 'anteprima'; end if;
  exception when sqlstate 'P0099' then
    return jsonb_build_object('dry_run', true, 'restored', v_ok, 'to_reschedule', v_ko, 'plan', v_plan);
  end;
  update public.cycles set status = 'attivo', review_date = null where id = c.id;
  perform app.log('ripresa', 'Ciclo di ' || v_pname || ' ripreso dal ' || app.fmt_d(p_from) || ': ' || v_ok
    || ' appuntamenti ripristinati, ' || v_ko || ' da riprogrammare per conflitti.', 'cycle', c.id::text, v_plan);
  return jsonb_build_object('dry_run', false, 'restored', v_ok, 'to_reschedule', v_ko, 'plan', v_plan);
exception when exclusion_violation then
  raise exception 'Un posto è stato occupato nel frattempo da un altro utente. Nessuna modifica salvata: riprova.' using hint = 'FA_SLOT';
end $$;

create function public.close_cycle(p_cycle uuid, p_version int, p_reason text, p_from date) returns jsonb
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
  select count(*) into v_done from public.appointments where cycle_id = c.id and status = 'effettuata';
  update public.cycles set status = 'chiuso', closed_reason = p_reason, closed_at = p_from,
    forecast = 'conclusione_confermata' where id = c.id;
  perform app.log('chiusura', 'Ciclo di ' || v_pname || ' chiuso dal ' || app.fmt_d(p_from) || ' (' || p_reason || '): '
    || v_done || ' sedute effettuate su ' || c.planned_sessions || ' previste; ' || v_n || ' appuntamenti futuri liberati.',
    'cycle', c.id::text, null);
  return jsonb_build_object('freed', v_n, 'done', v_done);
end $$;

-- ---------------------------------------------------------------------
-- Assenze dei fisioterapisti
-- ---------------------------------------------------------------------
create function public.save_absence(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.absences; v_id uuid := nullif(p->>'id', '')::uuid; v_txt text;
begin
  perform app.require_role('operatore');
  if v_id is not null then
    select * into v from public.absences where id = v_id for update;
    if not found then perform app.fail('Assenza non trovata.'); end if;
    if v.version <> (p->>'version')::int then perform app.stale('L''assenza', v.updated_by); end if;
  end if;
  if nullif(p->>'start_date', '') is null then perform app.fail('Indica la data di inizio.'); end if;
  if nullif(p->>'end_date', '') is null and nullif(p->>'plan_until', '') is null then
    perform app.fail('Rientro non noto: indica fino a quale data organizzare le sostituzioni.');
  end if;
  if (nullif(p->>'start_time', '') is null) <> (nullif(p->>'end_time', '') is null) then
    perform app.fail('Per una fascia oraria indica sia l''inizio sia la fine.');
  end if;
  if v_id is null then
    insert into public.absences (therapist_id, kind, start_date, end_date, start_time, end_time, plan_until, note, created_by)
    values ((p->>'therapist_id')::uuid, coalesce(p->>'kind', 'malattia'), (p->>'start_date')::date, nullif(p->>'end_date', '')::date,
      nullif(p->>'start_time', '')::time, nullif(p->>'end_time', '')::time,
      case when nullif(p->>'end_date', '') is null then nullif(p->>'plan_until', '')::date end, coalesce(p->>'note', ''), auth.uid())
    returning * into v;
  else
    update public.absences set kind = coalesce(p->>'kind', kind), start_date = (p->>'start_date')::date,
      end_date = nullif(p->>'end_date', '')::date, start_time = nullif(p->>'start_time', '')::time,
      end_time = nullif(p->>'end_time', '')::time,
      plan_until = case when nullif(p->>'end_date', '') is null then nullif(p->>'plan_until', '')::date end,
      note = coalesce(p->>'note', note)
    where id = v_id returning * into v;
  end if;
  v_txt := app.th_name(v.therapist_id) || ' assente (' || v.kind || ') '
    || case when v.end_date = v.start_date then 'il ' || app.fmt_d(v.start_date)
            when v.end_date is null then 'dal ' || app.fmt_d(v.start_date) || ', rientro non noto (organizzazione fino al ' || app.fmt_d(v.plan_until) || ')'
            else 'dal ' || app.fmt_d(v.start_date) || ' al ' || app.fmt_d(v.end_date) end
    || case when v.start_time is null then ', giornata intera' else ', dalle ' || app.fmt_t(v.start_time) || ' alle ' || app.fmt_t(v.end_time) end || '.';
  perform app.log(case when v_id is null then 'assenza' else 'assenza_modificata' end, v_txt, 'absence', v.id::text, p);
  return to_jsonb(v);
exception when check_violation then
  raise exception 'Date o orari dell''assenza non coerenti.' using hint = 'FA_INPUT';
end $$;

create function public.cancel_absence(p_id uuid, p_version int, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.absences;
begin
  perform app.require_role('operatore');
  select * into v from public.absences where id = p_id for update;
  if not found then perform app.fail('Assenza non trovata.'); end if;
  if v.version <> p_version then perform app.stale('L''assenza', v.updated_by); end if;
  update public.absences set cancelled = true, note = trim(note || ' ' || coalesce(p_note, '')) where id = p_id;
  perform app.log('assenza_annullata', 'Annullata l''assenza di ' || app.th_name(v.therapist_id) || ' dal ' || app.fmt_d(v.start_date)
    || '. Gli appuntamenti già sostituiti non vengono modificati.', 'absence', p_id::text, null);
end $$;

-- ---------------------------------------------------------------------
-- Configurazione (solo coordinatore)
-- ---------------------------------------------------------------------
create function app.validate_blocks(p jsonb, p_where text) returns void
language plpgsql immutable as $$
declare x jsonb; v_prev time; v_s time; v_e time;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception '%: fasce non valide.', p_where using hint = 'FA_INPUT'; end if;
  for x in select e from jsonb_array_elements(p) e order by (e->>'start')::time loop
    if coalesce(x->>'kind', '') not in ('amb', 'reparto', 'pausa', 'documentazione', 'preparazione', 'altro') then
      raise exception '%: tipo di fascia non valido.', p_where using hint = 'FA_INPUT';
    end if;
    v_s := (x->>'start')::time; v_e := (x->>'end')::time;
    if v_e <= v_s then raise exception '%: la fascia % termina prima di iniziare.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if v_prev is not null and v_s < v_prev then raise exception '%: fasce sovrapposte alle %.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if nullif(x->>'max', '') is not null and (x->>'max')::int < 1 then raise exception '%: numero massimo di pazienti non valido.', p_where using hint = 'FA_INPUT'; end if;
    v_prev := v_e;
  end loop;
end $$;

create function public.admin_save_therapist(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.therapists; v_id uuid := nullif(p->>'id', '')::uuid; s jsonb;
begin
  perform app.require_role('admin');
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
end $$;

create function public.admin_save_category(p_id text, p_name text, p_active boolean, p_sort int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('admin');
  if trim(coalesce(p_id, '')) = '' or trim(coalesce(p_name, '')) = '' then perform app.fail('Codice e nome del percorso sono obbligatori.'); end if;
  insert into public.categories (id, name, active, sort) values (trim(p_id), trim(p_name), coalesce(p_active, true), coalesce(p_sort, 0))
  on conflict (id) do update set name = excluded.name, active = excluded.active, sort = excluded.sort;
  perform app.log('configurazione', 'Percorso «' || trim(p_name) || '» salvato.', 'category', p_id, null);
end $$;

create function public.admin_save_closure(p_day date, p_label text, p_delete boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('admin');
  if p_delete then
    delete from public.closures where day = p_day;
    perform app.log('configurazione', 'Chiusura del ' || app.fmt_d(p_day) || ' eliminata.', 'closure', p_day::text, null);
  else
    if trim(coalesce(p_label, '')) = '' then perform app.fail('Indica la descrizione della chiusura.'); end if;
    insert into public.closures (day, label) values (p_day, trim(p_label)) on conflict (day) do update set label = excluded.label;
    perform app.log('configurazione', 'Chiusura del ' || app.fmt_d(p_day) || ' (' || trim(p_label) || ') salvata. Gli appuntamenti già presenti in quella data sono segnalati da sistemare.', 'closure', p_day::text, null);
  end if;
end $$;

-- appuntamenti di un fisioterapista non più compatibili con turno/variazioni (da una data)
create function app.th_conflicts(p_th uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('appointment_id', a.id, 'day', a.day, 'start_time', a.start_time,
           'end_time', a.end_time, 'patient', p.name, 'message', m.msg) order by a.day, a.start_time), '[]'::jsonb)
    from public.appointments a join public.patients p on p.id = a.patient_id
    cross join lateral (select app.check_slot(a.therapist_id, a.day, a.start_time, a.end_time, a.patient_id, a.id, a.cycle_id, false) msg) m
   where a.therapist_id = p_th and a.status in ('programmata', 'trattenuta') and a.day >= p_from
     and (p_to is null or a.day <= p_to) and m.msg is not null
$$;

-- Nuovo turno con decorrenza. Lo storico resta; gli appuntamenti già prenotati
-- non vengono spostati: quelli incompatibili sono mostrati e segnalati.
create function public.admin_save_shift(p_th uuid, p_valid_from date, p_week jsonb, p_note text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conf jsonb; d int; v_next date;
begin
  perform app.require_role('admin');
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
end $$;

create function public.admin_set_day_override(p_th uuid, p_day date, p_blocks jsonb, p_note text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conf jsonb;
begin
  perform app.require_role('admin');
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
end $$;

create function public.admin_set_user(p_user uuid, p_role text, p_active boolean, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  perform app.require_role('admin');
  select * into v from public.profiles where user_id = p_user for update;
  if not found then perform app.fail('Utente non trovato.'); end if;
  if p_role not in ('admin', 'operatore', 'lettura') then perform app.fail('Ruolo non valido.'); end if;
  if v.role = 'admin' and (p_role <> 'admin' or not p_active)
     and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    perform app.fail('Deve restare almeno un coordinatore attivo.');
  end if;
  update public.profiles set role = p_role, active = p_active, full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
   where user_id = p_user;
  perform app.log('utenti', 'Account ' || v.email || ': ruolo ' || p_role || case when p_active then '' else ', disattivato' end || '.',
    'profile', p_user::text, null);
end $$;

-- Primo coordinatore: da eseguire una sola volta dall'editor SQL di Supabase.
create function app.set_first_admin(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where role = 'admin' and active) then
    return 'Esiste già un coordinatore: usa la sezione Utenti dell''applicazione.';
  end if;
  update public.profiles set role = 'admin', active = true where lower(email) = lower(trim(p_email));
  if not found then return 'Nessun account con questa email: crealo prima in Authentication → Users.'; end if;
  insert into public.audit_log (user_name, action, summary) values ('sistema', 'utenti', 'Primo coordinatore impostato: ' || p_email);
  return 'Fatto: ' || p_email || ' è coordinatore.';
end $$;
revoke all on function app.set_first_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Backup e ripristino (solo coordinatore)
-- ---------------------------------------------------------------------
create function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := jsonb_build_object('format', 'fisioagenda-pilota', 'format_version', 1, 'exported_at', now(),
  'exported_by', app.my_name());
  t text; v jsonb;
begin
  perform app.require_role('admin');
  foreach t in array array['categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides', 'closures',
                           'absences', 'patients', 'cycles', 'appointments', 'audit_log'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''slot''), ''[]''::jsonb) from public.%I x', t) into v;
    r := r || jsonb_build_object(t, v);
  end loop;
  return r;
end $$;

-- Ripristino: sostituisce tutti i dati del servizio con quelli del file.
-- Account e storico attuale restano; il ripristino è registrato nello storico.
create function public.admin_restore(p jsonb, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text; v_cols text; v_n int; v_counts jsonb := '{}'::jsonb;
begin
  perform app.require_role('admin');
  if p_confirm is distinct from 'RIPRISTINA' then perform app.fail('Conferma mancante: scrivi RIPRISTINA.'); end if;
  if p->>'format' is distinct from 'fisioagenda-pilota' then perform app.fail('Il file non è un backup di FisioAgenda pilota.'); end if;
  perform set_config('app.restoring', 'on', true);
  -- (where true: richiesto dalla protezione contro le cancellazioni accidentali di Supabase)
  delete from public.appointments where true; delete from public.cycles where true; delete from public.patients where true;
  delete from public.absences where true; delete from public.day_overrides where true; delete from public.shift_versions where true;
  delete from public.therapist_skills where true; delete from public.therapists where true; delete from public.closures where true;
  delete from public.categories where true;
  foreach t in array array['categories', 'therapists', 'therapist_skills', 'shift_versions', 'day_overrides', 'closures',
                           'absences', 'patients', 'cycles', 'appointments'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', t, v_cols, v_cols, t)
      using coalesce(p->t, '[]'::jsonb);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;
  perform set_config('app.restoring', 'off', true);
  perform app.log('ripristino', 'Dati ripristinati dal backup del ' || coalesce(p->>'exported_at', '?') || '.', null, null, v_counts);
  return v_counts;
end $$;

-- ---------------------------------------------------------------------
-- Esposizione: solo agli utenti autenticati (il ruolo è verificato dentro)
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('whoami', 'appointment_issues', 'create_request', 'update_patient', 'update_cycle_info',
                'book_cycle', 'apply_substitutions', 'move_appointment', 'reschedule_cycle', 'register_outcome', 'book_recovery',
                'suspend_cycle', 'resume_cycle', 'close_cycle', 'save_absence', 'cancel_absence', 'admin_save_therapist',
                'admin_save_category', 'admin_save_closure', 'admin_save_shift', 'admin_set_day_override', 'admin_set_user',
                'admin_export', 'admin_restore') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on all functions in schema app from public, anon;
grant execute on function app.my_role(), app.is_reader() to authenticated;


-- >>> 20261005000003_grants.sql
-- =====================================================================
-- FisioAgenda — versione pilota condivisa
-- 3/3: autorizzazioni esplicite. Necessarie quando il progetto Supabase ha
-- l'esposizione automatica delle nuove tabelle DISATTIVATA (scelta consigliata).
-- Gli utenti autenticati possono solo LEGGERE (e solo se attivi, per RLS);
-- ogni modifica passa dalle funzioni del server. Gli anonimi non hanno accesso.
-- Si può rieseguire senza effetti collaterali.
-- =====================================================================
grant usage on schema public to authenticated;
grant usage on schema app to authenticated;

revoke all on public.categories, public.therapists, public.therapist_skills, public.shift_versions, public.day_overrides,
  public.closures, public.absences, public.patients, public.cycles, public.appointments, public.audit_log,
  public.profiles, public.row_changes from anon;

grant select on public.categories, public.therapists, public.therapist_skills, public.shift_versions, public.day_overrides,
  public.closures, public.absences, public.patients, public.cycles, public.appointments, public.audit_log,
  public.profiles, public.row_changes to authenticated;

revoke insert, update, delete, truncate on public.categories, public.therapists, public.therapist_skills, public.shift_versions,
  public.day_overrides, public.closures, public.absences, public.patients, public.cycles, public.appointments, public.audit_log,
  public.profiles, public.row_changes from authenticated;

-- RLS attiva su tutte le tabelle (anche se il progetto la attiva già in automatico)
alter table public.categories enable row level security;
alter table public.therapists enable row level security;
alter table public.therapist_skills enable row level security;
alter table public.shift_versions enable row level security;
alter table public.day_overrides enable row level security;
alter table public.closures enable row level security;
alter table public.absences enable row level security;
alter table public.patients enable row level security;
alter table public.cycles enable row level security;
alter table public.appointments enable row level security;
alter table public.audit_log enable row level security;
alter table public.profiles enable row level security;
alter table public.row_changes enable row level security;

grant execute on function app.my_role(), app.is_reader() to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('whoami', 'appointment_issues', 'create_request', 'update_patient', 'update_cycle_info',
                'book_cycle', 'apply_substitutions', 'move_appointment', 'reschedule_cycle', 'register_outcome', 'book_recovery',
                'suspend_cycle', 'resume_cycle', 'close_cycle', 'save_absence', 'cancel_absence', 'admin_save_therapist',
                'admin_save_category', 'admin_save_closure', 'admin_save_shift', 'admin_set_day_override', 'admin_set_user',
                'admin_export', 'admin_restore') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;


-- >>> 20261006000004_sedute_gia_svolte.sql
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


-- >>> 20261006000005_ruoli_cicli.sql
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


-- >>> 20261006000006_programmatore.sql
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


-- >>> 20261007000007_tipi_fasce.sql
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


-- >>> 20261007000008_calendario_flessibile.sql
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


-- >>> 20261008000009_importazione_tabulati.sql
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


-- >>> 20261009000010_sostituzioni_durate.sql
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


-- >>> 20261010000011_agenda.sql
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


-- >>> 20261011000012_tabulato_semplice.sql
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


-- >>> 20261012000013_avvisi.sql
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


-- >>> 20261118000014_codice_cartella.sql
-- =====================================================================
-- FisioAgenda — versione pilota: paziente indicato solo con il CODICE CARTELLA (anonimato).
-- Il campo patients.name contiene il codice cartella. Il server lo controlla sempre:
-- - lettere, cifre, spazio e / . - _ ; da 1 a 20 caratteri; almeno una cifra (un nome non passa);
-- - un codice = un paziente (maiuscole/minuscole e spazi non contano).
-- I dati già presenti non vengono toccati: per ripartire puliti c'è «Svuota pazienti e sedute».
-- Si può eseguire più volte.
-- =====================================================================

create or replace function app.code_key(p text) returns text language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(p, '')), '\s+', '', 'g'))
$$;

create or replace function app.check_patient_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- il ripristino da backup rimette i dati com'erano
  if current_setting('app.restoring', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then return new; end if;
  new.name := regexp_replace(trim(coalesce(new.name, '')), '\s+', ' ', 'g');
  if new.name = '' then
    perform app.fail('Scrivi il codice cartella del paziente.');
  end if;
  if length(new.name) > 20 or new.name !~* '^[a-z0-9 /._-]+$' then
    perform app.fail('Codice cartella «' || left(new.name, 30) || '» non valido: usa solo lettere, cifre e / . - _ (al massimo 20 caratteri). Niente nomi e cognomi.');
  end if;
  if new.name !~ '[0-9]' then
    perform app.fail('«' || new.name || '» non sembra un codice cartella: deve contenere almeno una cifra. Per l''anonimato non scrivere nomi e cognomi.');
  end if;
  if exists (select 1 from public.patients p where app.code_key(p.name) = app.code_key(new.name) and p.id <> new.id) then
    perform app.fail('Esiste già un paziente con il codice cartella ' || new.name || ': cercalo e usa quello.');
  end if;
  return new;
end $$;
revoke all on function app.check_patient_code() from public, anon;

drop trigger if exists check_patient_code on public.patients;
create trigger check_patient_code before insert or update of name on public.patients
  for each row execute function app.check_patient_code();

-- messaggi e storico: «codice cartella», non «nome»
create or replace function public.update_patient(p_id uuid, p_version int, p_name text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.patients;
begin
  perform app.require_role('operatore');
  select * into v from public.patients where id = p_id for update;
  if not found then perform app.fail('Paziente non trovato.'); end if;
  if v.version <> p_version then perform app.stale('Il paziente', v.updated_by); end if;
  if trim(coalesce(p_name, '')) = '' then perform app.fail('Il codice cartella non può essere vuoto.'); end if;
  update public.patients set name = trim(p_name), note = coalesce(p_note, '') where id = p_id;
  perform app.log('paziente', 'Paziente ' || v.name || case when app.code_key(v.name) <> app.code_key(p_name) then ': codice cartella cambiato in ' || trim(p_name) else ': nota modificata' end || '.', 'patient', p_id::text, null);
end $$;


-- >>> 20261118000015_percorsi_svuota.sql
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
