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
| Tabulato del mese | Come i fogli di carta, anche dal cellulare: righe = pazienti (nome, orario, giorni), colonne = giorni, nella casella il numero che scende (10→1). Mesi avanti e indietro senza limiti. Righe vuote per scrivere un paziente nuovo direttamente nella griglia. Tocco su una casella: sposta, durata, assente (con recupero), altro fisioterapista (una, un periodo o tutte), scambio con un altro paziente, cancella, «Annulla». Tocco sul nome: sedute, cambia ora dal… (anche per alcuni giorni), durata, passa a un collega dal…, sospendi/riprendi/concludi. Nessun trascinamento. La presenza non si segna: le sedute passate contano da sole, si segna solo l'assenza. Pulsante «Orario»: fasce settimanali (ambulatorio, pausa, ortesi, gruppo, progetto…) con nome scritto a mano e data di decorrenza; ognuno il proprio, segreteria/coordinatore/programmatore tutti. Vista Giorno e, per la segreteria, «Tutti i colleghi» (una colonna per fisioterapista). |
| Spie | Per segreteria, coordinatore, programmatore e chi ne fa le veci: **rossa** quando ferie/permesso/malattia lasciano pazienti da ricollocare (porta all'elenco); **gialla** per le modifiche ai tabulati fatte da altri, da consultare se si vuole («Visto», personale). |
| Sostituzioni | Elenco per periodo e fisioterapista: data e orario, titolare, sostituto, paziente, durata, stato (da assegnare / confermata); “Chi prende i pazienti” (distribuzione tra i colleghi); assegna, cambia, annulla; visibili nei calendari del sostituto e del titolare. |
| Permessi | Ognuno modifica il proprio tabulato; segreteria, coordinatore e programmatore tutti. Un fisioterapista può essere autorizzato a fare le veci della segreteria fino a una data. Fisioterapisti aggiunti/tolti dalla segreteria. Tutto verificato anche dal server. |
| Impostazioni | Fisioterapisti, orari con decorrenza e storico, ferie e assenze, percorsi, festività, utenti e permessi (anche a tempo), backup e ripristino, «Svuota pazienti e sedute» (con backup automatico prima). Importazione da foto e lista d'attesa tolte. |
| Regole mantenute | Sedute da 30, 45 o 60 minuti (o durata libera), scelte per paziente e modificabili per singola seduta; giorni e orario ricorrenti; cicli da 5, 10, 20 o 30 sedute (allungabili); posti certi distinti da quelli solo probabili, che non sono prenotabili. |

## Cosa è stato verificato

Verifiche su un'installazione **locale completa** di Supabase (stessi componenti del servizio online, avviati con Docker): database, login, permessi e tempo reale **reali**, non simulati. Non è ancora stato verificato sul progetto online, che va creato (vedi sotto).

- `npm test`: test del motore (turni, sostituti, conteggi, festività, posti probabili) e della lettura dei tabulati, senza server.
- `npm run test:server`: test sul server: permessi (anche autorizzazioni a tempo e agende dei colleghi), prenotazione simultanea dello stesso posto, modifiche contemporanee, assenze con sostituti, recuperi, sospensioni, chiusura anticipata, cambio turno con conflitti, scambio e «Annulla», conteggio con presenza implicita, spia gialla, svuotamento, tempo reale, backup e ripristino.
- `npm run test:e2e-agenda`: **10 prove nel browser a misura di cellulare** sul tabulato mensile: pazienti di oggi, paziente nuovo in una riga vuota (12:20 scritto a mano), attività di gruppo senza nomi, spostamento e «Annulla», scambio, seduta a un collega, assenza, spia rossa dopo le ferie, mesi passati, spia gialla e «Visto», orario cambiato da una data.
- `npm run test:e2e-vuoto`: **15 prove nel browser partendo da archivio vuoto** (colleghi, orari, paziente dal tabulato, variazioni per periodo, assenza, account fisioterapista).
- `npm run test:e2e`: **20 prove nel browser** con tre colleghi collegati insieme (stessa prenotazione nello stesso momento, aggiornamento senza ricaricare, mancanza di connessione, tablet 1024×768).

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
