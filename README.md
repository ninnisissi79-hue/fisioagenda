# FisioAgenda — demo (versione semplice v3)

> **Versione 3 (branch `fisioagenda-semplice-v3`)**: parte dalla prima versione semplice e aggiunge **soltanto** i percorsi *Mano* e *Chirurgia della mano / postoperatorio*, la **categoria di priorità** (U – Urgente, B – Breve, D – Differibile, P – Programmabile, Non indicata) e il **tipo di richiesta** (Prima seduta, Continuazione ciclo). Niente date di prescrizione, scadenze, conteggi dei termini, fisiatri o campi amministrativi.

Gestionale dimostrativo per organizzare l’attività ambulatoriale di un servizio ospedaliero di fisioterapia con 18 fisioterapisti.
Lo scopo principale è **assegnare rapidamente un paziente** e smaltire la lista d’attesa: inserisci i dati del paziente e vedi subito **chi può prenderlo, in quali giorni e a che ora, da quando**, distinguendo i posti **certi** da quelli solo **probabili**.

> **Tutti i nomi (colleghi e pazienti) sono inventati.** Le categorie cliniche sono esempi modificabili, non l’elenco reale del servizio.

---

## 1. Come aprire la demo

Non serve installare nulla: basta un browser recente (Chrome, Edge, Firefox o Safari).

**Modo più semplice: un solo file**
1. Su GitHub apri la cartella `dist` e poi il file **`FisioAgenda.html`**.
2. Premi il pulsante **“Download raw file”** (icona con la freccia verso il basso, in alto a destra sopra il contenuto).
3. Fai **doppio clic** sul file scaricato: si apre nel browser.

**In alternativa: la cartella completa**
1. Sulla pagina principale del progetto su GitHub premi **Code → Download ZIP**.
2. Estrai lo ZIP (tasto destro → “Estrai tutto”).
3. Fai doppio clic su **`index.html`**.

**Per chi usa Node.js** (facoltativo): `npm start` e poi apri http://localhost:8080.

**Per condividerla con un link (Netlify):** il pacchetto pronto è `dist/FisioAgenda-v3-netlify.zip` (contiene `index.html` e `_headers` nella cartella principale). Il file singolo è `dist/index.html`. Le istruzioni passo passo sono in [ISTRUZIONI-NETLIFY.md](ISTRUZIONI-NETLIFY.md). Rigenerazione: `npm run build:netlify`.

## 2. Prima prova (5 minuti)

1. Si apre **Trova un posto**. Scrivi un nome di fantasia, ad esempio “Prova A.”.
2. Scegli il **percorso**, ad esempio *Protesi anca / ginocchio*, poi durata **30 min**, frequenza **Lun-Mer-Ven** e **10** sedute.
3. (Facoltativo) Spunta **“indica”** nella fascia oraria e scegli, ad esempio, 12:00–15:00 come *preferenza flessibile*.
4. Premi **Cerca disponibilità**.
5. In alto vedi quattro riquadri:
   - **✓ Disponibili per nuovi cicli**: posti certi e prenotabili subito;
   - **✓ Posti futuri confermati**: certi, ma da una data successiva;
   - **? Posti futuri probabili**: dipendono da conclusioni non ancora confermate e **non si possono prenotare**;
   - **◻ Buchi singoli**: spazi isolati utili per recuperi, non per un ciclo intero.
6. Nella tabella in alto ci sono i colleghi con **★ competenza specifica**, poi quelli con **altra idoneità**. “▸ altri orari” mostra le alternative dello stesso collega; “Perché è compatibile” spiega il controllo eseguito.
7. Premi **📅 Calendario** per vedere tutte le date del ciclo (con le festività saltate), poi **✓ Conferma**.
8. Dopo la conferma si apre l’**Agenda** del collega con il nuovo paziente evidenziato in giallo.
9. Ricarica la pagina (tasto F5): il paziente è ancora lì.

Altre prove utili:
- **Lista d’attesa → “Trova posto”**: la ricerca parte già compilata, senza reinserire i dati.
- **Agenda → clic su una seduta**: registra *effettuata*, *assenza paziente*, *da recuperare*… e programma il recupero.
- **Ferie e malattie**: registra una malattia con **rientro non conosciuto** e guarda gli appuntamenti coinvolti (non vengono cancellati).
- **Pazienti e cicli → Apri**: cambia la previsione (per esempio *Sospensione*, scegliendo se mantenere o liberare il posto) oppure aggiungi un **rinnovo**.
- **Previsioni**: posti che si liberano e pazienti in lista compatibili, ordinati per priorità e attesa.

Novità della versione 3:
- **Trova un posto**: scegli il percorso *Mano* o *Chirurgia della mano / postoperatorio*; in alto i colleghi con competenza specifica, poi gli altri abilitati. Sotto la frequenza trovi il menu **Priorità** e il **Tipo di richiesta**.
- **Lista d’attesa**: la priorità è in evidenza; filtra con *U / B / D / P / Non indicata* e ordina per priorità o per data di inserimento.
- **Pazienti e cicli → Apri**: priorità e tipo di richiesta modificabili. Cambiarli non tocca cicli e sedute.

## 3. Dove vengono salvati i dati

- I dati sono salvati **solo nel browser del computer in uso** (archivio locale del browser, *localStorage*).
- Le modifiche **restano** dopo l’aggiornamento della pagina e dopo la chiusura del browser.
- **Limiti:** i dati **non sono condivisi** con altri computer o colleghi; non c’è accesso multiutente né login; cancellando i dati di navigazione si perdono; in navigazione anonima non vengono conservati. Ogni browser (Chrome, Edge, Firefox…) ha un archivio separato: i dati inseriti in uno non compaiono nell’altro.
- In **Impostazioni → Dati e salvataggio** puoi **esportare** i dati in un file, **importarli** e **ripristinare gli esempi** (con conferma).
- Se la demo è aperta in due schede dello stesso browser, la seconda viene avvisata delle modifiche. Prima di ogni conferma i conflitti vengono comunque ricontrollati sui dati salvati più recenti.
- Lo **storico delle modifiche importanti** (ultime 500) è in Impostazioni → Storico modifiche.

## 4. Assunzioni usate (tutte modificabili)

| Tema | Assunzione nella demo | Dove si modifica |
|---|---|---|
| Pazienti contemporanei | **Un paziente alla volta per fisioterapista** (confermato dal servizio) | regola del motore |
| Gruppo ingresso 7:00 (7:00–14:12) | preparazione 7:00–7:15 · ambulatorio 7:15–9:00 · reparto 9:00–12:00 · pausa 12:00–12:20 · ambulatorio 12:20–**13:20** · *estensione da confermare* 13:20–**13:50** · cartelle fino alle 14:12 | Impostazioni → Schemi di turno; scheda del collega |
| Gruppo ingresso 8:00 (8:00–15:12) | preparazione 8:00–8:15 · **un solo paziente** 8:15–9:00 · reparto 9:00–12:20 · pausa 12:20–12:40 · ambulatorio 12:40–**14:45** · *estensione* 14:45–**15:00** · cartelle fino alle 15:12 | come sopra |
| Due colleghi solo ambulatoriali | **orari reali**: ingresso 8:00, uscita 15:12; pazienti dalle 8:15 alle **14:40** (fino alle **14:45** come estensione da confermare); pausa 12:20–12:40; sedute da 30 o 45 min; da 6 a 8 pazienti al giorno (limite impostato: 8) | Impostazioni → Schemi di turno; scheda del collega |
| Estensione | prenotabile solo con **conferma esplicita**; mai oltre fine turno né sopra reparto, pausa o cartelle | scheda / schemi |
| Riserva provvisoria | per “da valutare” e “prosecuzione prevista” senza rinnovo: **4 settimane** dopo l’ultima seduta, visibile in agenda; poi il posto diventa *probabile*, mai certo | Impostazioni → Parametri; data per singolo percorso |
| Avviso aggiornamento previsione | quando mancano **3** sedute | Impostazioni → Parametri |
| “Disponibile subito” | inizio entro **7 giorni** dalla prima data utile; oltre è “futuro confermato” | Impostazioni → Parametri |
| Avviso sedute da 45 | oltre **2** al giorno, solo per i gruppi con reparto; è un avviso, non un divieto | Impostazioni → Parametri |
| Festività | festività nazionali italiane + una chiusura di esempio; il **Santo Patrono non è inserito** | Impostazioni → Festività e chiusure |
| Chiusure nel ciclo | la data viene **saltata** e il ciclo si allunga (la seduta non è contata) | — |
| Ferie del collega durante un nuovo ciclo | il ciclo **non viene proposto** con quel collega (stesso collega per tutto il ciclo); nessun salto automatico | — |
| Sedute che liberano la data | assenza paziente, annullata dal servizio, da recuperare: lo spazio in quella data diventa utilizzabile (es. per recuperi) | — |
| Conteggio sedute | contano programmate, effettuate, assenze e da recuperare; una seduta *recuperata* è contata una volta sola tramite il suo recupero; una seduta *annullata dal servizio* non conta e il ciclo mostra “mancano N” | — |
| Orari proposti | solo orari “naturali” (inizio fascia, subito prima o dopo altri appuntamenti), per evitare decine di alternative quasi identiche | — |
| Priorità | U – Urgente, B – Breve, D – Differibile, P – Programmabile, Non indicata: **scelta dall’operatore** in base alla richiesta, mai dedotta dalla patologia. Evidenzia la priorità organizzativa; **non** è una verifica dei tempi previsti dalla normativa (nessuna data, scadenza o conteggio) | scheda in lista d’attesa, ricerca, scheda del paziente |
| Tipo di richiesta | Prima seduta / Continuazione ciclo: solo un’indicazione, non modifica né azzera cicli e sedute | come sopra |
| Percorsi della mano | *Mano* e *Chirurgia della mano / postoperatorio*, associabili alle competenze dei colleghi | Impostazioni → Categorie cliniche; scheda del collega |
| Dati salvati con la prima versione | conservati; le vecchie priorità (Alta/Media/Bassa) diventano “Non indicata” con il valore precedente visibile “da riclassificare” (nessuna conversione automatica); categorie Mano equivalenti già presenti vengono riusate | — |
| Sabato | non lavorativo, ma attivabile per singolo collega | scheda del collega |

## 5. Regole principali applicate dal motore

1. **Vincoli obbligatori** (escludono la proposta): idoneità esplicita al percorso, durata, fasce ambulatoriali, assenze, nessuna sovrapposizione, giorni e fascia obbligatoria del paziente, copertura di **tutte** le date del ciclo con lo stesso collega e lo stesso orario.
2. **Ordinamento**: prima competenza specifica, poi altri idonei; all’interno, compatibilità con la preferenza e prima data utile. In alternativa: prima disponibilità assoluta. Nessuna classifica per “chi finisce prima”.
3. **Previsioni**: “da valutare” e “prosecuzione” non liberano il posto (riserva provvisoria esplicita); “probabile conclusione” rende il posto futuro *probabile* indicando da quale paziente dipende (se dipende da più conclusioni le mostra tutte); “conclusione confermata” libera il posto **dopo** l’ultima seduta, che resta occupata; la sospensione chiede se mantenere o liberare il posto, con data di riesame; interruzione e “non avviato” liberano gli appuntamenti futuri solo dopo conferma.
4. **Posti probabili**: non prenotabili; si può registrare un **preaccordo**, che resta separato dalle prenotazioni e non occupa l’agenda.
5. **Programmato ≠ effettuato**: nessuna seduta diventa effettuata da sola; le date passate senza esito vengono segnalate.
6. **Assenze**: aggiornano le disponibilità e segnalano tutti gli appuntamenti coinvolti, senza cancellarli né spostare altri pazienti; con rientro non noto nessuna disponibilità successiva appare certa.
7. **Date e orari**: date di calendario e orari locali Europe/Rome, senza conversioni di fuso: gli appuntamenti non si spostano con il cambio dell’ora.
8. **Doppio controllo**: prima di confermare un’assegnazione, un rinnovo, un recupero o una sostituzione i conflitti vengono ricalcolati sui dati aggiornati.

## 6. Cosa è stato verificato

- **54 test automatici** (`npm test`): i 45 della prima versione, invariati e superati, più 9 per la v3 (`tests/v3.test.js`): percorsi Mano senza duplicati e associati alle competenze; ricerca con prima la competenza specifica e poi gli altri abilitati; rifiuto di un collega non abilitato; priorità mai dedotta dal percorso; assenza di scadenze e date; ordinamento per priorità; “Continuazione ciclo” che non modifica cicli né sedute effettuate; aggiornamento dei dati salvati con la prima versione senza perdite; riuso di categorie equivalenti.
- Test della prima versione (`npm test`), tra cui tutti i casi richiesti: spazio di 30 min che non ospita una seduta da 45; appuntamento che inizia esattamente alla fine del precedente; nessuna sovrapposizione con reparto, pausa e cartelle; buco presente solo il lunedì che non basta per lun-mer-ven; controllo di tutte le date (anche la decima); un solo paziente mattutino per il gruppo delle 8; malattia a metà ciclo; rientro ignoto; decima seduta senza previsione; posto probabile non prenotabile; rinnovo con aggiornamento delle previsioni e conflitti; seduta finale occupata con conclusione confermata; recupero non contato due volte; festività e chiusure; sospensione con posto mantenuto o liberato; 4×30 dalle 12:40 → 14:40; 45+3×30 dalle 12:40 → 14:55 come estensione da verificare (17 minuti residui per le cartelle); cambio dell’ora del 25/10/2026; prenotazione concorrente dello stesso posto.
- **Prova completa dell’interfaccia nel browser** (`npm run test:e2e`, Chromium): nuovo paziente → ricerca → calendario del ciclo → conferma → agenda con evidenza → **ricaricamento della pagina con dati conservati** → recupero con conteggio invariato → malattia con rientro non noto → “Trova posto” dalla lista d’attesa → controllo del layout tablet (1024×768) → ripristino degli esempi con conferma. Per la v3 la prova include anche: menu priorità e tipo di richiesta, ricerca e assegnazione Mano, modifica dalla scheda paziente senza effetti sulle sedute, filtro e ordinamento per priorità in lista, assenza di campi su scadenze/prescrizioni/fisiatri, caricamento dei dati salvati con la prima versione. La stessa prova è stata eseguita su `index.html` e sul file unico `dist/index.html`.

## 7. Cosa manca (possibili passi successivi)

- **Uso condiviso e multiutente**: serve un server con database e accesso con credenziali. Il motore è già separato dall’interfaccia, quindi può essere riusato lato server; andranno aggiunti blocco delle prenotazioni concorrenti a livello di database, profili utente e registro modifiche per utente.
- Spostamento degli appuntamenti trascinandoli in agenda e modifica dell’orario di una singola seduta (oggi si passa da recupero o sostituzione).
- Ricerca di cicli con orari diversi nei vari giorni (per esempio lunedì 8:15 e mercoledì 12:40) o con cambio di collega a metà ciclo: oggi la ricerca ordinaria cerca lo stesso orario e lo stesso collega, mentre recuperi e sostituzioni sono espliciti e confermati.
- Opzione per allungare automaticamente un ciclo saltando le ferie note del collega.
- Stampa ed esportazione dell’agenda (PDF/Excel) e notifiche ai colleghi.
- Verifica dei valori reali ancora da confermare: limiti dell’ambulatorio pomeridiano dei gruppi con reparto, tempo per le cartelle, soglia delle sedute da 45, durata della riserva provvisoria, festività locali.

## 8. Per chi sviluppa

```
index.html            pagina principale (apribile con doppio clic)
css/app.css           stile
js/engine.js          MOTORE DI DISPONIBILITÀ: solo regole, nessuna interfaccia (usato anche dai test)
js/demo-data.js       generatore dei dati fittizi (date relative al giorno di primo avvio)
js/app.js             interfaccia (viste, finestre, salvataggio locale)
tests/engine.test.js  test del motore (node --test)
tests/demo.test.js    test di coerenza dei dati demo
tests/v3.test.js      test della versione 3 (Mano, priorità, tipo di richiesta, aggiornamento dati)
tests/fixtures/       dati salvati con la prima versione, per verificare l'aggiornamento
tests/e2e.js          prova completa nel browser (Playwright)
tools/build.js        crea dist/FisioAgenda.html (file unico)
tools/build-netlify.js crea dist/FisioAgenda-v3-netlify.zip (index.html + _headers) e dist/index.html
tools/serve.js        server locale facoltativo (npm start)
```

Comandi: `npm test` · `npm run test:e2e` (richiede Playwright; `E2E_URL=http://…` per provare un indirizzo web) · `npm run build:netlify` (pacchetto ZIP per Netlify) · `npm run build` (da rieseguire dopo ogni modifica, per aggiornare `dist/FisioAgenda.html`) · `npm start`.
Nessuna dipendenza esterna: niente librerie da scaricare, funziona anche senza connessione a Internet.
