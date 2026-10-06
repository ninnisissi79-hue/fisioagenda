# FisioAgenda — versione pilota condivisa

Progetto **separato** dalle demo precedenti, che restano invariate: v3 nel branch `fisioagenda-semplice-v3` e nella cartella principale, con i loro siti Netlify.
Parte dalla versione semplice concordata: percorsi *Mano* e *Chirurgia della mano*, categoria di priorità, prima seduta oppure continuazione del ciclo. Non gestisce l'agenda dei fisiatri: le visite fisiatriche (la «V» dei tabulati) sono solo promemoria sul paziente.

> **Solo pazienti fittizi.** Non inserire dati reali: il pilota non è stato valutato per dati sanitari reali (privacy, contratti, sede dei dati).

## Architettura

```
Browser (PC/tablet)  ──HTTPS──▶  Supabase (piano gratuito)
 pagina statica                    • PostgreSQL: archivio centrale unico
 web/                              • Auth: account personali, registrazione libera disattivata
  ├ engine.js  proposte            • Regole e permessi nel database (RLS + funzioni)
  ├ store.js   lettura/salvataggio • Realtime: modifiche visibili agli altri colleghi
  └ app-*.js   interfaccia
```

- **Il server decide.** L'interfaccia propone (sostituti, posti, distribuzioni); ogni conferma passa da una funzione del database che ricontrolla ruolo, versione dei dati, turni, assenze, reparto, pause, documentazione, chiusure, limiti di fascia e giornalieri, competenze e posti solo probabili.
- **Doppie prenotazioni impossibili:** vincolo di esclusione PostgreSQL (`no_double_booking`, `no_patient_overlap`) più blocco per fisioterapista. Vale anche con conferme nello stesso istante.
- **Modifiche contemporanee:** ogni riga ha una versione. Chi salva su dati non aggiornati riceve “modificato nel frattempo da …” e i dati vengono ricaricati.
- **Storico:** ogni operazione scrive chi, cosa e quando (`audit_log`); in più c'è un registro tecnico di ogni riga modificata (`row_changes`, visibile solo al coordinatore). Nulla viene cancellato: annullamenti, posti liberati e sedute spostate restano come traccia.
- **Ruoli:** coordinatore (`admin`), operatore, sola consultazione. Le tabelle sono in sola lettura per tutti; le scritture passano solo dalle funzioni, che verificano il ruolo.
- **Nessun segreto nel codice:** `web/config.js` (escluso da git) contiene solo l'indirizzo del progetto e la chiave *pubblica*. Le password le gestisce Supabase.

## Cosa fa

| Area | Funzioni |
|---|---|
| Schermata iniziale | Due azioni (assenza fisioterapista, trova posto) e un riepilogo di assenti, appuntamenti da sistemare e posti liberi. Le attività da sistemare restano sempre visibili in alto. |
| Assenza imprevista | Fisioterapista → oggi / altro giorno / più giorni → giornata intera o fascia oraria → “rientro non noto”, con data fino a cui organizzare. Appuntamenti coinvolti con sostituti: stesso orario e competenza specifica, poi gli altri abilitati, poi gli orari diversi (⚠). La proposta distribuisce i pazienti su più colleghi ed è modificabile. Due scelte sullo stesso posto sono marcate come alternative e bloccano la conferma. Senza soluzione: “da riprogrammare” con motivo. Si distinguono sostituzione per una seduta, sostituzione per il periodo e cambio stabile del fisioterapista. Riepilogo prima della conferma, esito per ogni voce. |
| Calendario e paziente | Spostare una sola seduta (giorno, ora, fisioterapista); modificare le sedute future da una data; esito della seduta (effettuata, assenza, annullata dal paziente o dal servizio) con recupero; sospensione con motivo (ticket, clinico, indisponibilità, altro) e scelta esplicita tra posti mantenuti (con rivalutazione) o liberati; ripresa con nuova verifica; chiusura anticipata con anteprima dei posti liberati. |
| Calendario del fisioterapista | Posto di lavoro unico: navigazione libera tra le date (giorno/settimana). “✎ Orario” (coordinatore/programmatore): pennelli per ambulatorio, reparto, pausa, cartelle/adempimenti, segreteria, corso, permesso a ore, recupero ore, briefing; trascina per dipingere (15′ con aggancio ai bordi), sposta e ridimensiona, orari precisi scritti liberamente (12:20), duplica e copia giornate, schemi riutilizzabili; bozza + Salva per solo quelle date, da una data in poi o per un periodo (con ritorno automatico), con verifica dei conflitti e elenco degli appuntamenti da sistemare. Clic su uno spazio libero: paziente (anche già alla seduta n. X di Y) con orari diversi per giorno e anteprima delle sedute sul calendario; variazioni “solo questa seduta / questa e le successive / dal … al …”. |
| Importa tabulato | Foto del tabulato cartaceo + trascrizione (preparata da Claude in chat, nessun servizio esterno dal sito): fisioterapista, mese, “importa dal”, durata; anteprima con la foto accanto e la casella evidenziata; numeri a ritroso (seduta n. = 11 − numero, originale conservato), R recupero, V visita fisiatrica (evento del paziente, non seduta); letture incerte in giallo da correggere o confermare; pazienti già presenti, doppioni, foto già importate o sovrapposte, conflitti con “importa comunque” solo per fuori turno; date passate solo programmate; sedute oltre quelle lette solo su scelta esplicita; pazienti di colleghi trattati in sostituzione; annullamento dell'importazione. |
| Correzioni rapide | Dal calendario del collega: trascina una seduta per cambiarne giorno/ora; “✎ Correggi” per nome, numero della seduta, sedute previste, tipo, durata, visita fisiatrica ed eliminazione di una seduta inserita per errore; spazio libero → paziente in archivio (aggiunge le sedute mancanti al ciclo in corso), sedute già fatte → prossima seduta. |
| Configurazione | 18 fisioterapisti, competenze (specifica/abilitato), solo ambulatorio o anche reparto, turni settimanali individuali con decorrenza e storico (conflitti mostrati prima del salvataggio), variazioni giornaliere, ferie e assenze, percorsi, festività, utenti, backup e ripristino. |
| Regole mantenute | Sedute da 30 o 45 minuti; giorni e orario ricorrenti; cicli da 5, 10, 20 o 30 sedute; posti certi distinti da quelli solo probabili, che non sono prenotabili. |

## Cosa è stato verificato

Verifiche su un'installazione **locale completa** di Supabase (stessi componenti del servizio online, avviati con Docker): database, login, permessi e tempo reale **reali**, non simulati. Non è ancora stato verificato sul progetto online, che va creato (vedi sotto).

- `npm test`: **10 test del motore** e **9 test della lettura dei tabulati** (numeri a ritroso, R, V, salti, frequenza, data di inizio), senza server. Turni individuali, distribuzione tra più sostituti, nessun sostituto, cambio orario, alternative, assenza parziale o senza rientro, posti probabili, festività, conteggi.
- `npm run test:server`: **21 test sul server** più **5 sull'importazione e le correzioni rapide** (numeri a ritroso, date passate solo programmate, nessun doppione, conflitti tutto-o-niente, annullamento, mese successivo, sostituzioni, ruolo fisioterapista, elimina/rinumera/durata/sedute aggiunte/visite, spostamento di una seduta passata) (tra cui ruolo fisioterapista, previsione dei cicli, programmatore, ciclo già in corso, calendario flessibile):
  - permessi (sola consultazione, operatore che tenta modifiche riservate, scrittura diretta sulle tabelle, utente non autenticato, account disattivato);
  - **prenotazione simultanea dello stesso posto** da parte di due utenti, ripetuta tre volte;
  - modifiche contemporanee;
  - assente oggi con distribuzione tra più sostituti;
  - nessun sostituto compatibile;
  - alternative sullo stesso posto;
  - assenza parziale;
  - assenza senza rientro;
  - paziente assente con recupero;
  - sospensione per ticket e ripresa con un posto nel frattempo occupato;
  - chiusura anticipata;
  - modifica di una sola seduta;
  - cambio turno con conflitti;
  - posto solo probabile;
  - tempo reale;
  - backup e ripristino.
- `node tests/e2e-vuoto.mjs`: **15 prove nel browser partendo da archivio vuoto** (inserimento colleghi, turni dipinti sul calendario con orari precisi, paziente dal calendario, variazioni per periodo, recupero, account fisioterapista).
- `npm run test:e2e-import`: **8 prove nel browser** con un tabulato fittizio: foto accanto ai dati, letture incerte, conferma, ricarica senza doppioni, annullamento, trascinamento, ✎ Correggi, paziente in archivio dallo spazio libero.
- `npm run test:e2e`: **20 prove nel browser** con tre colleghi collegati insieme. Comprende la stessa prenotazione confermata da due utenti nello stesso momento, l'aggiornamento visibile senza ricaricare, la mancanza di connessione e il layout su tablet 1024×768.

## Cosa resta da fare (da parte tua)

1. Creare il progetto Supabase gratuito e installare il database: vedi [ISTRUZIONI-PILOTA.md](ISTRUZIONI-PILOTA.md), passi 1–3.
2. Creare gli account dei colleghi (passo 4).
3. Solo quando lo chiederai: pubblicare il sito su un **nuovo** progetto Netlify separato (passo 5). Nessun sito esistente viene toccato.

Finché questi passi non sono fatti, la condivisione **non è attiva**: il pilota funziona solo nell'ambiente locale di prova.

## Limiti noti

- Piano gratuito di Supabase: nessun backup automatico scaricabile, quindi usa il backup dall'app o la procedura `pg_dump`. Il progetto va in pausa dopo una settimana senza utilizzo e si riattiva dal pannello. Limite di 500 MB.
- L'email integrata di Supabase invia messaggi solo ai membri del team: gli account dei colleghi si creano con una password temporanea, che ognuno cambia con il pulsante **Password**. Per gli inviti via email serve un servizio SMTP esterno.
- La ricerca di un nuovo ciclo cerca lo stesso fisioterapista e lo stesso orario per tutte le date. Orari diversi o un cambio di collega si gestiscono poi seduta per seduta.
- Dati caricati: appuntamenti degli ultimi 120 giorni e futuri. È adeguato per il pilota; per anni di storico servirà la paginazione per periodo.
- Nessuna stampa o esportazione PDF/Excel dell'agenda.
- La lettura delle foto dei tabulati non avviene nel sito (nessun servizio esterno, nessun costo): la trascrizione la prepara Claude in chat dalle foto anonimizzate, oppure si compila il foglio a mano nell'anteprima. Le foto non vengono salvate sul server, solo la loro impronta per riconoscere i doppioni.

## Per chi sviluppa

```
supabase/migrations/   schema, vincoli, permessi, funzioni (le regole di riferimento)
supabase/seed.sql      dati dimostrativi fittizi
supabase/setup-completo.sql   le migrazioni in un unico file per l'editor SQL (npm run build)
web/                   sito statico (index.html, css, js); config.example.js → config.js
tests/                 engine.test.mjs, sheet.test.mjs, server.test.mjs, import.test.mjs, e2e*.mjs
esempi/                tabulato fittizio (foto + trascrizione) e trascrizioni dei tabulati di prova
tools/                 serve.js (server locale), local-config.mjs, build.mjs
```

Comandi:
- `npm install`
- `npm run db:start` (richiede Docker)
- `node tools/local-config.mjs`
- `npm start`, poi apri http://localhost:8090
- `npm test`, `npm run test:server`, `npm run test:e2e` (prima `npx supabase db reset`)
- `npm run build`
