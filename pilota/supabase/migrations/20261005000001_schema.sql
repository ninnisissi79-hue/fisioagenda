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
create policy lettura on public.profiles for select to authenticated
  using (user_id = auth.uid() or app.is_reader());
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
