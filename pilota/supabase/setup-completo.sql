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
