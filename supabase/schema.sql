-- =====================================================================
--  RE-HAND · Database Supabase  (versione che CONVIVE con altre app)
--  Da incollare UNA VOLTA in Supabase → SQL Editor → New query → Run.
--
--  • Tutte le tabelle iniziano con "rehand_": non tocca le tabelle
--    delle altre app presenti nello stesso progetto.
--  • NON modifica gli utenti esistenti e non aggiunge trigger su di loro.
--  • Un account entra in RE-HAND solo quando si registra/accede
--    DALL'APP RE-HAND:
--      - il PRIMO in assoluto diventa amministratore
--      - tutti gli altri restano "in_attesa" finché l'amministratrice
--        non li abilita (editor o lettore) dall'app.
--
--  Ruoli:
--   admin      modifica e pubblica, approva le richieste, gestisce utenti
--   editor     modifica, ma le modifiche diventano richieste da approvare
--   lettore    vede e stampa
--   in_attesa  nessun accesso finché non viene abilitato
-- =====================================================================

create table if not exists public.rehand_profili (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text,
  ruolo   text not null default 'in_attesa' check (ruolo in ('admin','editor','lettore','in_attesa')),
  creato  timestamptz not null default now()
);

create or replace function public.rehand_mio_ruolo() returns text
language sql stable security definer set search_path = public as $$
  select ruolo from public.rehand_profili where id = auth.uid()
$$;
create or replace function public.rehand_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ruolo = 'admin' from public.rehand_profili where id = auth.uid()), false)
$$;
create or replace function public.rehand_attivo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ruolo in ('admin','editor','lettore') from public.rehand_profili where id = auth.uid()), false)
$$;

-- chiamata dall'app dopo l'accesso: crea il profilo RE-HAND se manca e restituisce il ruolo
create or replace function public.rehand_registrati() returns text
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  perform pg_advisory_xact_lock(4242);
  insert into public.rehand_profili (id, email, ruolo)
  select auth.uid(), u.email,
         case when exists (select 1 from public.rehand_profili where ruolo = 'admin') then 'in_attesa' else 'admin' end
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  select ruolo into r from public.rehand_profili where id = auth.uid();
  return r;
end $$;

create or replace function public.rehand_proteggi_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ruolo = 'admin' and new.ruolo <> 'admin'
     and (select count(*) from public.rehand_profili where ruolo = 'admin') <= 1 then
    raise exception 'Deve restare almeno un amministratore';
  end if;
  return new;
end $$;
drop trigger if exists rehand_ultimo_admin on public.rehand_profili;
create trigger rehand_ultimo_admin before update on public.rehand_profili
  for each row execute function public.rehand_proteggi_admin();

-- ---------- opuscoli pubblicati + storico versioni ----------
create table if not exists public.rehand_opuscoli (
  id             text primary key,
  dati           jsonb not null,
  versione       int  not null default 1,
  aggiornato     timestamptz not null default now(),
  aggiornato_da  uuid references auth.users(id)
);
create table if not exists public.rehand_revisioni (
  id           bigserial primary key,
  opuscolo_id  text not null,
  dati         jsonb not null,
  versione     int,
  autore       uuid,
  creato       timestamptz not null default now()
);
create or replace function public.rehand_salva_revisione() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rehand_revisioni (opuscolo_id, dati, versione, autore)
  values (old.id, old.dati, old.versione, old.aggiornato_da);
  if tg_op = 'DELETE' then return old; end if;
  new.aggiornato := now();
  new.aggiornato_da := coalesce(auth.uid(), new.aggiornato_da);
  return new;
end $$;
drop trigger if exists rehand_revisione on public.rehand_opuscoli;
create trigger rehand_revisione before update or delete on public.rehand_opuscoli
  for each row execute function public.rehand_salva_revisione();

-- ---------- richieste di modifica ----------
create table if not exists public.rehand_richieste (
  id            bigserial primary key,
  opuscolo_id   text not null,
  dati          jsonb not null,
  nota          text,
  autore        uuid not null default auth.uid() references auth.users(id),
  autore_email  text,
  stato         text not null default 'in_attesa' check (stato in ('in_attesa','approvata','rifiutata')),
  commento      text,
  creato        timestamptz not null default now(),
  deciso_da     uuid references auth.users(id),
  deciso_il     timestamptz
);

-- ---------- impostazioni comuni e decisioni sugli aggiornamenti ----------
create table if not exists public.rehand_impostazioni (
  id          int primary key default 1 check (id = 1),
  dati        jsonb not null default '{}'::jsonb,
  aggiornato  timestamptz not null default now()
);
create table if not exists public.rehand_decisioni (
  proposta_id  text primary key,
  stato        text not null check (stato in ('accettata','rifiutata')),
  data         date not null default current_date,
  deciso_da    uuid default auth.uid()
);

-- =====================================================================
--  Sicurezza (Row Level Security)
-- =====================================================================
alter table public.rehand_profili      enable row level security;
alter table public.rehand_opuscoli     enable row level security;
alter table public.rehand_revisioni    enable row level security;
alter table public.rehand_richieste    enable row level security;
alter table public.rehand_impostazioni enable row level security;
alter table public.rehand_decisioni    enable row level security;

drop policy if exists rh_profili_leggi on public.rehand_profili;
create policy rh_profili_leggi on public.rehand_profili for select to authenticated
  using (id = auth.uid() or public.rehand_is_admin());
drop policy if exists rh_profili_admin on public.rehand_profili;
create policy rh_profili_admin on public.rehand_profili for update to authenticated
  using (public.rehand_is_admin()) with check (public.rehand_is_admin());
drop policy if exists rh_profili_admin_del on public.rehand_profili;
create policy rh_profili_admin_del on public.rehand_profili for delete to authenticated
  using (public.rehand_is_admin() and id <> auth.uid());

drop policy if exists rh_opuscoli_leggi on public.rehand_opuscoli;
create policy rh_opuscoli_leggi on public.rehand_opuscoli for select to authenticated using (public.rehand_attivo());
drop policy if exists rh_opuscoli_ins on public.rehand_opuscoli;
create policy rh_opuscoli_ins on public.rehand_opuscoli for insert to authenticated with check (public.rehand_is_admin());
drop policy if exists rh_opuscoli_upd on public.rehand_opuscoli;
create policy rh_opuscoli_upd on public.rehand_opuscoli for update to authenticated using (public.rehand_is_admin()) with check (public.rehand_is_admin());
drop policy if exists rh_opuscoli_del on public.rehand_opuscoli;
create policy rh_opuscoli_del on public.rehand_opuscoli for delete to authenticated using (public.rehand_is_admin());

drop policy if exists rh_revisioni_admin on public.rehand_revisioni;
create policy rh_revisioni_admin on public.rehand_revisioni for select to authenticated using (public.rehand_is_admin());

drop policy if exists rh_richieste_leggi on public.rehand_richieste;
create policy rh_richieste_leggi on public.rehand_richieste for select to authenticated
  using (autore = auth.uid() or public.rehand_is_admin());
drop policy if exists rh_richieste_nuova on public.rehand_richieste;
create policy rh_richieste_nuova on public.rehand_richieste for insert to authenticated
  with check (autore = auth.uid() and public.rehand_mio_ruolo() in ('editor','admin') and stato = 'in_attesa');
drop policy if exists rh_richieste_decidi on public.rehand_richieste;
create policy rh_richieste_decidi on public.rehand_richieste for update to authenticated
  using (public.rehand_is_admin()) with check (public.rehand_is_admin());
drop policy if exists rh_richieste_ritira on public.rehand_richieste;
create policy rh_richieste_ritira on public.rehand_richieste for delete to authenticated
  using (public.rehand_is_admin() or (autore = auth.uid() and stato = 'in_attesa'));

drop policy if exists rh_impostazioni_leggi on public.rehand_impostazioni;
create policy rh_impostazioni_leggi on public.rehand_impostazioni for select to authenticated using (public.rehand_attivo());
drop policy if exists rh_impostazioni_ins on public.rehand_impostazioni;
create policy rh_impostazioni_ins on public.rehand_impostazioni for insert to authenticated with check (public.rehand_is_admin());
drop policy if exists rh_impostazioni_upd on public.rehand_impostazioni;
create policy rh_impostazioni_upd on public.rehand_impostazioni for update to authenticated using (public.rehand_is_admin()) with check (public.rehand_is_admin());

drop policy if exists rh_decisioni_leggi on public.rehand_decisioni;
create policy rh_decisioni_leggi on public.rehand_decisioni for select to authenticated using (public.rehand_attivo());
drop policy if exists rh_decisioni_admin on public.rehand_decisioni;
create policy rh_decisioni_admin on public.rehand_decisioni for all to authenticated using (public.rehand_is_admin()) with check (public.rehand_is_admin());

-- le funzioni RE-HAND sono usabili solo da utenti autenticati
revoke all on function public.rehand_registrati() from public, anon;
grant execute on function public.rehand_registrati() to authenticated;

-- =====================================================================
--  Richieste di NUOVE PATOLOGIE (dall'app "Cerca o richiedi una patologia")
--  Le legge la ricerca automatica di Claude, che prepara la brochure
--  e la propone in "Aggiorna" (l'amministratrice sceglie Sì/No).
--  La ricerca automatica può leggere solo nome della patologia e dettagli
--  (non chi l'ha chiesta).
-- =====================================================================
create table if not exists public.rehand_patologie_richieste (
  id         bigserial primary key,
  patologia  text not null check (length(patologia) between 2 and 120),
  dettagli   text check (dettagli is null or length(dettagli) <= 600),
  autore     uuid not null default auth.uid() references auth.users(id),
  creato     timestamptz not null default now()
);
alter table public.rehand_patologie_richieste enable row level security;
drop policy if exists rh_patric_leggi on public.rehand_patologie_richieste;
create policy rh_patric_leggi on public.rehand_patologie_richieste for select to authenticated using (public.rehand_attivo());
drop policy if exists rh_patric_nuova on public.rehand_patologie_richieste;
create policy rh_patric_nuova on public.rehand_patologie_richieste for insert to authenticated
  with check (autore = auth.uid() and public.rehand_attivo());
drop policy if exists rh_patric_admin_del on public.rehand_patologie_richieste;
create policy rh_patric_admin_del on public.rehand_patologie_richieste for delete to authenticated using (public.rehand_is_admin());
-- lettura per la ricerca automatica (chiave pubblica): solo le colonne non personali
drop policy if exists rh_patric_anon on public.rehand_patologie_richieste;
create policy rh_patric_anon on public.rehand_patologie_richieste for select to anon using (true);
revoke all on public.rehand_patologie_richieste from anon;
grant select (id, patologia, dettagli, creato) on public.rehand_patologie_richieste to anon;
