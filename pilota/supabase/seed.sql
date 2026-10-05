-- =====================================================================
-- FisioAgenda — versione pilota: DATI DI PARTENZA (eseguire una volta).
-- Contiene solo i percorsi (modificabili dall'app) e le festività nazionali.
-- Fisioterapisti, competenze, turni, ferie, malattie e pazienti si inseriscono dall'app.
-- =====================================================================
insert into public.categories (id, name, sort) values
  ('mano', 'Mano', 1), ('chir_mano', 'Chirurgia della mano / postoperatorio', 2),
  ('orto', 'Ortopedia post-chirurgica', 3), ('protesi', 'Protesi anca / ginocchio', 4), ('spalla', 'Spalla', 5),
  ('rachide', 'Rachide / lombalgia', 6), ('neuro', 'Neurologico', 7), ('onco', 'Oncologico', 8),
  ('linf', 'Linfedema', 9), ('pelv', 'Pavimento pelvico', 10), ('resp', 'Riabilitazione respiratoria', 11),
  ('ortesi', 'Ambulatorio ortesi', 12)
on conflict (id) do nothing;

-- festività nazionali 2026–2027 (il Santo Patrono non è inserito: aggiungilo dall'app)
insert into public.closures (day, label) values
  ('2026-01-01','Capodanno'),('2026-01-06','Epifania'),('2026-04-06','Lunedì dell''Angelo'),('2026-04-25','Festa della Liberazione'),
  ('2026-05-01','Festa del Lavoro'),('2026-06-02','Festa della Repubblica'),('2026-08-15','Ferragosto'),('2026-11-01','Ognissanti'),
  ('2026-12-08','Immacolata Concezione'),('2026-12-25','Natale'),('2026-12-26','Santo Stefano'),
  ('2027-01-01','Capodanno'),('2027-01-06','Epifania'),('2027-03-29','Lunedì dell''Angelo'),('2027-04-25','Festa della Liberazione'),
  ('2027-05-01','Festa del Lavoro'),('2027-06-02','Festa della Repubblica'),('2027-08-15','Ferragosto'),('2027-11-01','Ognissanti'),
  ('2027-12-08','Immacolata Concezione'),('2027-12-25','Natale'),('2027-12-26','Santo Stefano')
on conflict (day) do nothing;

insert into public.audit_log (user_name, action, summary)
values ('sistema', 'avvio', 'Installati i percorsi e le festività di partenza. Fisioterapisti e pazienti da inserire dall''app.');
