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
