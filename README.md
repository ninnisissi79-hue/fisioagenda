# Hand Lab

Web app per esercizi interattivi della mano su tablet, con taratura iniziale, programmi personalizzati,
valutazioni, progressi, modalità ricerca e **monitoraggio a distanza** da parte del fisioterapista.

> **Stato: prima versione di sviluppo.** Non è un dispositivo medico, non è dichiarata pronta per
> l'uso clinico né conforme alla normativa (MDR, GDPR, ecc.). Le prove touchscreen sono
> **sperimentali e non validate**. Usare solo con dati dimostrativi finché non sono completate le
> verifiche indicate in fondo.

## Architettura

```
shared/   TypeScript comune: catalogo esercizi, motori degli esercizi (logica pura e testata),
          aderenza prescritto/eseguito, progressione, confrontabilità, schemi di validazione
server/   Node.js + Fastify + SQLite (node:sqlite): autenticazione, autorizzazioni, sincronizzazione,
          programmi e tarature versionati, ricerca ed esportazioni
web/      React + TypeScript + Vite: PWA installabile, vista fisioterapista e vista paziente,
          coda offline in IndexedDB
e2e/      verifica end-to-end in Chromium con tocchi multipli simulati
```

* **Backend condiviso fin dall'inizio**: ogni fisioterapista e ogni paziente ha un account; i dati
  sono sul server e si sincronizzano tra dispositivi. Il tablet conserva solo la copia del programma
  (per lavorare offline) e la coda delle attività da inviare.
* **Autorizzazioni sul server**: il paziente vede solo i propri dati; il professionista solo i pazienti
  assegnati, con livello *responsabile*, *modifica* o *sola lettura*; il responsabile può autorizzare
  colleghi del team. L'amministratore gestisce gli account ma non vede i dati clinici.
* **Offline e duplicati**: ogni seduta, esecuzione e segnalazione ha un identificativo generato sul
  tablet; il server ignora i reinvii e non fa regredire uno stato definitivo. Il tablet dichiara quando
  la coda è vuota: solo allora un giorno senza attività diventa "non effettuato", altrimenti resta
  "nessuna attività ricevuta".
* **Programmi versionati**: ogni modifica crea una nuova versione con data di decorrenza; le versioni
  precedenti e i risultati restano invariati. La seduta fissa la versione all'avvio: le modifiche
  ricevute durante una seduta si applicano dalla successiva; ogni esecuzione registra la versione.

### Decisioni tecniche (reversibili)

| Decisione | Motivo | Come cambiarla |
|---|---|---|
| SQLite integrato in Node (`node:sqlite`, Node ≥ 22.5) | nessuna dipendenza nativa, un file da sottoporre a backup | lo strato SQL è in `server/src`; migrabile a PostgreSQL |
| Sessioni con cookie HttpOnly + SameSite=Strict, token salvati solo come hash, password scrypt | standard, nessun segreto nel browser | `server/src/auth.ts` |
| Protezione CSRF con intestazione `x-handlab` obbligatoria | semplice ed efficace con SameSite | idem |
| Coordinate **normalizzate** (u = lato corto dell'area di gioco) | i pixel del browser non sono millimetri | mm solo con calibrazione fisica esplicita (tessera ID-1) |
| Pointer Events per il multitouch | supportati da Safari iPadOS ≥ 13 e Chrome Android | `web/src/exercise/TouchSurface.tsx` |
| Motori esercizi come logica pura in `shared` | testabili con tocchi simulati, riusabili | `shared/src/engines` |
| CSV con separatore `;` e BOM UTF-8 | apertura diretta in Excel italiano | `shared/src/csv.ts` |

## Avvio rapido (demo)

Requisiti: **Node.js 22.5 o successivo**.

```bash
npm install
npm run seed          # crea data/handlab.sqlite con dati DIMOSTRATIVI (pazienti fittizi)
npm run build         # compila l'interfaccia
npm start             # server su http://localhost:8787
```

Account dimostrativi (password per tutti: `demo-handlab`):

| Utente | Ruolo |
|---|---|
| `ft.demo` | fisioterapista responsabile dei pazienti DEMO |
| `collega.demo` | fisioterapista con accesso in sola lettura a DEMO-001 |
| `admin.demo` | amministratore (solo gestione account) |
| `demo001` | paziente DEMO-001 (mano destra, con storico dimostrativo) |
| `demo002` | paziente DEMO-002 (mano sinistra) |

I dati dimostrativi sono generati con formule deterministiche (non casuali) e sono sempre marcati
**DEMO** nell'interfaccia. `npm run seed -- --reset` ricrea il database dimostrativo.

Sviluppo con ricaricamento automatico: `npm run dev` (API su 8787, interfaccia su http://localhost:5173).

### Uso reale (pilota)

```bash
HANDLAB_DB=/percorso/sicuro/handlab.sqlite npm run create-user -- --username mrossi --name "M. Rossi" --role therapist --password "password-temporanea"
HANDLAB_DB=/percorso/sicuro/handlab.sqlite COOKIE_SECURE=1 TRUST_PROXY=1 npm start
```

* Pubblicare il server **solo in HTTPS** (es. dietro un reverse proxy): è necessario per i cookie
  sicuri, per l'installazione sulla schermata Home e per il funzionamento offline (service worker).
* Il database è un singolo file: pianificare **backup** regolari e cifrati (file `.sqlite`, `-wal`).
* Il fisioterapista crea i pazienti e il loro accesso dalla scheda paziente.
* Prima di dati reali servono: valutazione d'impatto, nomina dei ruoli privacy, hosting adeguato,
  revisione di sicurezza. Questa versione non li sostituisce.

## Test eseguibili

```bash
npm test              # unità (shared: motori, aderenza, progressione, CSV) + integrazione API (server)
npm run typecheck     # controllo dei tipi su shared, server e web
./e2e/prepare.sh && npm run e2e   # end-to-end in Chromium con tocchi multipli simulati
```

Vedi `VERIFICHE.md` per l'elenco delle verifiche eseguite e dei risultati, e per la
**procedura di prova fisica su iPad e tablet Android**.

## Funzioni

### Complete in questa versione
* Autenticazione reale, account per fisioterapisti e pazienti, autorizzazioni per paziente, team.
* Cruscotto: programma attuale, ultima attività, sedute complete/previste, esercizi non effettuati o
  interrotti, segnalazioni, andamento delle misure principali, ultima sincronizzazione.
* Scheda paziente (codice, fascia d'età, mano interessata e dominante, problema, intervento e data, fase,
  limitazioni, obiettivi, note) con cronologia delle modifiche.
* Taratura guidata versionata (mano → posizionamento → dita una alla volta → disposizione simultanea →
  aree confortevoli approvate → prova); riposizionamento a inizio seduta separato dalla taratura.
* Cinque esercizi completi: Pinza sul piano, Scorrimento di un dito, Pianoforte, Segui la strada,
  Insegui il bersaglio — istruzioni, dimostrazione animata, dita, parametri, prova non registrata, pausa,
  stop con motivo, risultati, criteri di completamento espliciti; disposizione speculare per la mano sinistra.
* Programmi personalizzati versionati: esercizi e ordine, mano e dita, serie/ripetizioni o durata, pause,
  difficoltà, frequenza (volte al giorno e giorni), decorrenza, sospensione, sostituzione, eliminazione,
  progressione automatica facoltativa limitata a parametro, passo e limite autorizzati.
* Verifica dell'esecuzione: prescritto/iniziato/completato/interrotto/non effettuato, "nessuna attività
  ricevuta", orari, serie e ripetizioni rilevate, tempo attivo (escluse pause, riposo e app in secondo piano),
  motivi di interruzione e sintomi.
* Progressi separati in A (riferiti dal paziente), B (prestazioni touchscreen: allenamento e prove a
  condizioni fisse in grafici distinti, condizioni diverse come serie distinte) e C (misure cliniche);
  confronto tra esecuzioni selezionate con segnalazione delle differenze; note e modifica del programma
  dalla stessa scheda. Nessun punteggio di recupero complessivo.
* Valutazioni: misure cliniche con unità e strumento, stati separati per zero/mancante/errore,
  correzioni con motivo; questionari solo con inserimento manuale di strumento, versione e punteggio;
  prove touchscreen a condizioni fisse in ambulatorio.
* Modalità ricerca: studi (titolo, codice, versione protocollo, obiettivo, ipotesi, criteri, gruppi
  manuali, intervento, outcome, valutazioni con finestre), partecipanti con codice di studio, consenso
  documentato, stati delle valutazioni, abbandoni e deviazioni, eventi e segnalazioni; esportazioni CSV
  valutazioni, CSV sessioni, CSV calendario, JSON tecnico, dizionario delle variabili; sintesi descrittive.
* Offline: esercizi con programma in copia locale, coda IndexedDB, sincronizzazione al ritorno della
  rete, recupero delle sedute interrotte da chiusura dell'app.
* Copia di sicurezza JSON per paziente e reimportazione senza duplicati.
* Verifica guidata del touchscreen (contatti simultanei realmente rilevati) e calibrazione fisica facoltativa.

### Da sviluppare
* Esercizi in catalogo non ancora disponibili: Movimento del pollice, Ventaglio, Raccogli e sposta, Due
  dita due percorsi, Allarga la figura, Ruota la figura, Tocca a ritmo, Ripeti la sequenza.
* Questionari compilabili (QuickDASH e altri) dopo verifica di versione italiana ufficiale, licenza e regole di calcolo.
* Recupero password autonomo, autenticazione a due fattori per i professionisti, scadenza password.
* Registro di audit a prova di manomissione, backup automatici, cifratura del database a riposo.
* Notifiche al fisioterapista (es. segnalazioni di dolore) e promemoria al paziente.
* Più tablet per lo stesso paziente: funziona, ma la completezza dei dati è confermata solo quando tutti
  i tablet usati negli ultimi 30 giorni hanno sincronizzato.
* Test automatici dell'interfaccia oltre al percorso e2e principale; prove di accessibilità con screen reader.
* Validazione delle prove touchscreen (affidabilità, validità) prima di qualsiasi uso come misura di esito.
