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
