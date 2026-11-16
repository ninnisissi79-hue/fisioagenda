-- =====================================================================
--  RE-HAND · Database Supabase
--  Da incollare UNA VOLTA in Supabase → SQL Editor → New query → Run.
--
--  Ruoli:
--   admin   = amministratrice: modifica e pubblica, approva/rifiuta le
--             richieste, gestisce utenti, impostazioni e aggiornamenti
--   editor  = può modificare le brochure, ma le modifiche diventano
--             RICHIESTE che l'amministratrice approva o rifiuta
--   lettore = vede e stampa, non modifica
--
--  Il PRIMO utente che si registra diventa automaticamente admin.
--  Tutti gli altri entrano come "lettore"; l'admin li promuove dall'app.
-- =====================================================================

-- ---------- profili utenti ----------
create table if not exists public.profili (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text,
  nome    text,
  ruolo   text not null default 'lettore' check (ruolo in ('admin','editor','lettore')),
  creato  timestamptz not null default now()
);

create or replace function public.mio_ruolo() returns text
language sql stable security definer set search_path = public as $$
  select ruolo from public.profili where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ruolo = 'admin' from public.profili where id = auth.uid()), false)
$$;

-- nuovo utente → profilo; il primo in assoluto diventa admin
create or replace function public.nuovo_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili (id, email, ruolo)
  values (new.id, new.email,
          case when exists (select 1 from public.profili where ruolo = 'admin') then 'lettore' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists rehand_nuovo_utente on auth.users;
create trigger rehand_nuovo_utente after insert on auth.users
  for each row execute function public.nuovo_utente();

-- impedisce di togliere l'ultimo amministratore
create or replace function public.proteggi_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ruolo = 'admin' and new.ruolo <> 'admin'
     and (select count(*) from public.profili where ruolo = 'admin') <= 1 then
    raise exception 'Deve restare almeno un amministratore';
  end if;
  return new;
end $$;
drop trigger if exists rehand_ultimo_admin on public.profili;
create trigger rehand_ultimo_admin before update on public.profili
  for each row execute function public.proteggi_ultimo_admin();

-- ---------- opuscoli (brochure pubblicate) ----------
create table if not exists public.opuscoli (
  id             text primary key,
  dati           jsonb not null,
  versione       int  not null default 1,
  aggiornato     timestamptz not null default now(),
  aggiornato_da  uuid references auth.users(id)
);

-- ogni modifica salva la versione precedente (per tornare indietro)
create table if not exists public.revisioni (
  id           bigserial primary key,
  opuscolo_id  text not null,
  dati         jsonb not null,
  versione     int,
  autore       uuid,
  creato       timestamptz not null default now()
);

create or replace function public.salva_revisione() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.revisioni (opuscolo_id, dati, versione, autore)
  values (old.id, old.dati, old.versione, old.aggiornato_da);
  if tg_op = 'DELETE' then return old; end if;
  new.aggiornato := now();
  new.aggiornato_da := coalesce(auth.uid(), new.aggiornato_da);
  return new;
end $$;
drop trigger if exists rehand_revisione on public.opuscoli;
create trigger rehand_revisione before update or delete on public.opuscoli
  for each row execute function public.salva_revisione();

-- ---------- richieste di modifica (dagli editor) ----------
create table if not exists public.richieste (
  id            bigserial primary key,
  opuscolo_id   text not null,
  dati          jsonb not null,          -- l'opuscolo come lo vorrebbe l'editor
  nota          text,
  autore        uuid not null default auth.uid() references auth.users(id),
  autore_email  text,
  stato         text not null default 'in_attesa' check (stato in ('in_attesa','approvata','rifiutata')),
  commento      text,                    -- motivazione dell'admin
  creato        timestamptz not null default now(),
  deciso_da     uuid references auth.users(id),
  deciso_il     timestamptz
);

-- ---------- impostazioni comuni (loghi, contatti, testi) ----------
create table if not exists public.impostazioni (
  id          int primary key default 1 check (id = 1),
  dati        jsonb not null default '{}'::jsonb,
  aggiornato  timestamptz not null default now()
);

-- ---------- decisioni sugli aggiornamenti scientifici (Sì / No) ----------
create table if not exists public.decisioni (
  proposta_id  text primary key,
  stato        text not null check (stato in ('accettata','rifiutata')),
  data         date not null default current_date,
  deciso_da    uuid default auth.uid()
);

-- =====================================================================
--  Sicurezza (Row Level Security)
-- =====================================================================
alter table public.profili      enable row level security;
alter table public.opuscoli     enable row level security;
alter table public.revisioni    enable row level security;
alter table public.richieste    enable row level security;
alter table public.impostazioni enable row level security;
alter table public.decisioni    enable row level security;

drop policy if exists profili_leggi on public.profili;
create policy profili_leggi on public.profili for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profili_admin on public.profili;
create policy profili_admin on public.profili for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists opuscoli_leggi on public.opuscoli;
create policy opuscoli_leggi on public.opuscoli for select to authenticated using (true);
drop policy if exists opuscoli_admin_ins on public.opuscoli;
create policy opuscoli_admin_ins on public.opuscoli for insert to authenticated with check (public.is_admin());
drop policy if exists opuscoli_admin_upd on public.opuscoli;
create policy opuscoli_admin_upd on public.opuscoli for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists opuscoli_admin_del on public.opuscoli;
create policy opuscoli_admin_del on public.opuscoli for delete to authenticated using (public.is_admin());

drop policy if exists revisioni_admin on public.revisioni;
create policy revisioni_admin on public.revisioni for select to authenticated using (public.is_admin());

drop policy if exists richieste_leggi on public.richieste;
create policy richieste_leggi on public.richieste for select to authenticated
  using (autore = auth.uid() or public.is_admin());
drop policy if exists richieste_nuova on public.richieste;
create policy richieste_nuova on public.richieste for insert to authenticated
  with check (autore = auth.uid() and public.mio_ruolo() in ('editor','admin') and stato = 'in_attesa');
drop policy if exists richieste_decidi on public.richieste;
create policy richieste_decidi on public.richieste for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists richieste_ritira on public.richieste;
create policy richieste_ritira on public.richieste for delete to authenticated
  using (public.is_admin() or (autore = auth.uid() and stato = 'in_attesa'));

drop policy if exists impostazioni_leggi on public.impostazioni;
create policy impostazioni_leggi on public.impostazioni for select to authenticated using (true);
drop policy if exists impostazioni_admin_ins on public.impostazioni;
create policy impostazioni_admin_ins on public.impostazioni for insert to authenticated with check (public.is_admin());
drop policy if exists impostazioni_admin_upd on public.impostazioni;
create policy impostazioni_admin_upd on public.impostazioni for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists decisioni_leggi on public.decisioni;
create policy decisioni_leggi on public.decisioni for select to authenticated using (true);
drop policy if exists decisioni_admin on public.decisioni;
create policy decisioni_admin on public.decisioni for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- utenti già registrati prima di questo script (se ce ne sono)
insert into public.profili (id, email, ruolo)
select u.id, u.email, 'lettore' from auth.users u
on conflict (id) do nothing;
update public.profili set ruolo = 'admin'
where id = (select id from public.profili order by creato limit 1)
  and not exists (select 1 from public.profili where ruolo = 'admin');
