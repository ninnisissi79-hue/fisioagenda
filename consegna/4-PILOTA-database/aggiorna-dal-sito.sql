-- FisioAgenda: aggiornamento completo + togli tutti i pazienti. Prima carica lo zip su Netlify, poi incolla questo in Supabase → SQL Editor → Run.
create extension if not exists http with schema extensions;
do $$
declare r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');
  r := extensions.http_get('https://fisioagenda-pilota.netlify.app/aggiornamento-database.sql');
  if r.status <> 200 or md5(r.content) <> '01123ebef64fd2e7c481e11f731b8e94' then
    raise exception 'Aggiornamento non trovato sul sito (codice %): carica prima lo zip su Netlify, poi riprova.', r.status;
  end if;
  execute r.content;
  perform app.clear_patients();
end $$;
select case when to_regclass('public.therapist_alerts') is not null and not exists (select 1 from public.patients)
  then 'FATTO: aggiornamento completato e pazienti tolti' else 'NON FATTO: guarda il messaggio di errore' end as esito;
