-- RE-HAND · Archivio dei PDF per il QR del paziente (da eseguire UNA volta nel SQL Editor di Supabase).
-- Crea il contenitore "rehand-pdf": i PDF si aprono solo conoscendo l'indirizzo segreto (contenuto nel QR),
-- nessuno può elencarli; possono caricarli solo gli utenti RE-HAND abilitati. L'app cancella i file dopo 30 giorni.
-- Non tocca nient'altro del progetto (né le altre app né le impostazioni di accesso).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rehand-pdf', 'rehand-pdf', true, 20971520, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists rh_pdf_carica on storage.objects;
create policy rh_pdf_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'rehand-pdf' and public.rehand_attivo());

drop policy if exists rh_pdf_vedi on storage.objects;
create policy rh_pdf_vedi on storage.objects for select to authenticated
  using (bucket_id = 'rehand-pdf' and (owner_id = (select auth.uid())::text or public.rehand_is_admin()));

drop policy if exists rh_pdf_cancella on storage.objects;
create policy rh_pdf_cancella on storage.objects for delete to authenticated
  using (bucket_id = 'rehand-pdf' and (owner_id = (select auth.uid())::text or public.rehand_is_admin()));
