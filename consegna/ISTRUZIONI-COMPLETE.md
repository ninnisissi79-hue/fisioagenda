# FisioAgenda — istruzioni complete

Questa cartella contiene tutto: le due demo che avevi online, il pilota condiviso con importazione dei tabulati, gli script del database, le trascrizioni dei tabulati e il codice completo.

| File | Cosa contiene | Dove va |
|---|---|---|
| `1-DEMO-prima-versione-netlify.zip` | La prima demo (dati fittizi, nessun server) | Progetto Netlify **fisioagenda-demo** |
| `2-DEMO-v3-semplice-netlify.zip` | La demo v3 “semplice” (dati fittizi, nessun server) | Progetto Netlify **fisioagenda-semplice-v3** |
| `3-PILOTA-sito-netlify.zip` | Il pilota condiviso, **già collegato al vostro Supabase** (`cihywdeiyrawgcglxbcg`): importazione dei tabulati, calendario, correzioni | Progetto Netlify **fisioagenda-pilota** (non serve modificare nulla) |
| `4-PILOTA-database/` | `setup-completo.sql` (prima installazione), `aggiornamento-database.sql` (aggiornamento), `seed.sql` (dati di esempio fittizi, facoltativo) | Supabase → SQL Editor |
| `5-TRASCRIZIONI-tabulati.zip` | Le trascrizioni dei 17 tabulati di ottobre 2026 + un tabulato fittizio di prova | Si caricano nell'app, pagina **Importa tabulato** |
| `6-PROGETTO-COMPLETO-codice.zip` | Tutto il codice del progetto | Copia di sicurezza |

> **Regola d'oro:** ogni zip va nel **suo** progetto Netlify. Se trascini uno zip nel progetto sbagliato, quel sito viene sostituito.

---

## 1. Se l'app non si apre più

Il caso più frequente: un pacchetto è stato caricato nel progetto sbagliato (per esempio il pilota nel progetto della demo v3). Il sito allora mostra “Page not found”, una pagina bianca o l'accesso con la scritta rossa “Configurazione mancante”.

**Soluzione A — torna alla versione precedente (1 minuto, non si perde nulla)**

1. Apri **https://app.netlify.com** e accedi.
2. Clicca il progetto che non funziona (es. `fisioagenda-semplice-v3`).
3. Apri **Deploys**: vedi l'elenco delle pubblicazioni, la più recente in alto.
4. Clicca la pubblicazione **precedente**, quella che funzionava.
5. Premi **Publish deploy**. Dopo pochi secondi il link torna a funzionare.

**Soluzione B — ricarica lo zip giusto**

1. Apri il progetto su Netlify → **Deploys**.
2. In fondo alla pagina c'è il riquadro “Drag and drop…”: trascinaci lo zip giusto **senza estrarlo**:
    - progetto `fisioagenda-semplice-v3` → `2-DEMO-v3-semplice-netlify.zip`
    - progetto `fisioagenda-demo` → `1-DEMO-prima-versione-netlify.zip`
3. Il link resta lo stesso. Aprilo in una finestra anonima per controllare.

**Se vedi “Site not available” o un avviso sui limiti:** Netlify ha messo in pausa il progetto. Controlla gli avvisi in alto nella pagina di Netlify e la sezione *Usage / Billing*.

**Dal telefono (WhatsApp):** se il link si apre nel browser interno di WhatsApp e non funziona, tocca i tre puntini → **Apri nel browser**.

---

## 2. Le due demo (nessuna installazione)

Le demo funzionano da sole: dati fittizi salvati solo nel browser di chi le usa, nessun database.

**Pubblicare o aggiornare una demo**

1. app.netlify.com → apri il progetto della demo → **Deploys**.
2. Trascina lo zip della demo (senza estrarlo) nel riquadro in fondo.

**Creare una demo nuova:** app.netlify.com → **Add new project → Deploy manually** → trascina lo zip. Poi **Project configuration → Change project name** per scegliere il nome del link.

---

## 3. Il pilota condiviso — prima installazione

Il pilota è l'app con archivio comune per tutti i colleghi, importazione dei tabulati e correzioni dal calendario. Servono **Supabase** (database, gratuito) e un **nuovo** progetto Netlify.

### 3.1 Supabase (circa 10 minuti)

1. Vai su **https://supabase.com**, crea un account gratuito.
2. **New project**: nome `fisioagenda-pilota`, regione europea (es. *Frankfurt*), piano **Free**. Premi *Generate* per la password del database e salvala: **non inviarla a nessuno**.
3. Quando il progetto è pronto: **SQL Editor → New query** → incolla tutto il contenuto di `4-PILOTA-database/setup-completo.sql` → **Run**. Deve comparire “Success”.
4. (Facoltativo) Nuova query con `seed.sql` per avere fisioterapisti e pazienti **fittizi** di esempio. Per lavorare con i vostri colleghi **non serve**.
5. **Authentication → Sign In / Providers**: disattiva **Allow new users to sign up**.
6. **Authentication → Users → Add user → Create new user**: crea il tuo account (email + password temporanea, spunta *Auto Confirm User*).
7. SQL Editor, una sola volta, con la tua email:
    `select app.set_first_admin('tua.email@esempio.it');`
8. Copia due dati da **Project Settings → API Keys** (o *Data API*):
    - **Project URL** (`https://xxxxxxxx.supabase.co`)
    - **Publishable key** (`sb_publishable_…`), oppure la chiave *anon public*.

    Sono dati **pubblici**. Non usare mai la *secret key* o la chiave *service_role*.

### 3.2 Netlify (circa 5 minuti)

1. **Estrai** `3-PILOTA-sito-netlify.zip` in una cartella (sul computer: tasto destro → Estrai tutto).
2. Apri `config.js` con **Blocco note** e sostituisci:
    - `INSERISCI_QUI_IL_PROJECT_URL` → il tuo Project URL
    - `INSERISCI_QUI_LA_PUBLISHABLE_KEY` → la tua Publishable key

    Lascia gli apici `' '` intorno ai valori. Salva.

3. app.netlify.com → **Add new project → Deploy manually** → trascina **la cartella** estratta (non lo zip originale).
4. **Project configuration → Change project name**: es. `fisioagenda-pilota`. Il link diventa `https://fisioagenda-pilota.netlify.app`.
5. Torna su Supabase → **Authentication → URL Configuration → Site URL**: incolla il link del sito.
6. Apri il link, accedi con il tuo account, cambia la password con il pulsante **Password**.

### 3.3 Colleghi

1. Supabase → **Authentication → Users → Add user** per ogni collega (password temporanea, *Auto Confirm User*).
2. Nell'app: **Configurazione → Utenti** → assegna il ruolo (Fisioterapista, Operatore, Sola consultazione) e collega ogni fisioterapista al suo nome.
3. Comunica la password temporanea **di persona**; al primo accesso ognuno la cambia.

### 3.4 Fisioterapisti e turni
**Configurazione → Fisioterapisti**: inserisci i colleghi **con il cognome scritto sui tabulati** (Barile, Battistel, Bizzo, …): così l'importazione li riconosce da sola. Poi il turno di ognuno (anche dal calendario con **✎ Orario**).

---

## 4. Aggiornare un pilota già installato

> **Il vostro caso.** Il pacchetto `3-PILOTA-sito-netlify.zip` è già collegato al vostro database: **non** va estratto né modificato. Basta il punto 1 (database) e poi trascinare lo zip, così com'è, in Netlify → **fisioagenda-pilota** → **Deploys**.

1. Supabase → SQL Editor → incolla `4-PILOTA-database/aggiornamento-database.sql` → **Run**. Si può rieseguire senza problemi e non tocca i dati.
2. Prepara il sito come al punto 3.2 (estrai, compila `config.js` con gli **stessi** dati di prima).
3. Netlify → progetto del **pilota** → **Deploys** → trascina la cartella. Il link resta lo stesso.

---

## 5. Importare i tabulati

1. Estrai `5-TRASCRIZIONI-tabulati.zip`. Ogni file `.json` è un tabulato (es. `barile-ottobre-2026.json`).
2. Nell'app: **Importa tabulato → Scegli foto e trascrizione…** → seleziona insieme la **foto** del foglio e il suo **.json**. La foto resta sul computer: non viene inviata a nessuno.
3. Controlla **fisioterapista, mese, “Importa dal”** e scegli la **durata** (30′, 45′, 1 ora o altro; poi cambiala per i pazienti che hanno una durata diversa).
4. **Anteprima**: a sinistra la foto, a destra una riga per paziente. Clicca una casella: si evidenzia sulla foto.
    - **In giallo** le letture incerte: correggi il valore o conferma con ✓.
    - Bordo **rosso** = riga da sistemare: il motivo è scritto sotto.
    - Nome già presente: scegli se è lo stesso paziente o un omonimo.
    - **Sigle dei colleghi** sotto i numeri (es. MG): scegli il collega; la seduta va nel suo calendario come sostituzione.
    - Fuori turno / assenza: correggi oppure spunta “importa comunque” (finirà in “Da sistemare”).
5. **Importa nel calendario.**
6. Riquadro **Assenze segnate sul foglio** (F ferie, M malattia, P permesso): premi **Registra** se sono corrette.
7. Le sedute già passate entrano **programmate**: registra l'esito (effettuata / assenza) dal calendario o da **Da sistemare**.

Regole di lettura: numero a ritroso (seduta n. = 11 − numero), **R** recupero, **V** visita fisiatrica (promemoria, non è una seduta), **//** fine ciclo, se dopo l'1 la riga riparte da 10 è un nuovo ciclo.
Ricaricare lo stesso foglio **non crea doppioni**. Un'importazione sbagliata si annulla da **Importazioni recenti → Annulla**.

**Per provare senza dati veri:** crea un fisioterapista di nome **Fittizio** e importa `tabulato-fittizio.png` con `tabulato-fittizio.json`.

---

## 6. Gestire gli appuntamenti dal calendario del collega
- **+ Aggiungi paziente** (in alto): fisioterapista e giorno già impostati, modificabili; paziente nuovo, in trattamento o dalla lista d’attesa; ora di inizio e durata.
- **Pazienti in trattamento**: elenco con sedute fatte / programmate / prossima. **+ Seduta** aggiunge una seduta al suo ciclo (stessa anagrafica, stessa numerazione).
- Clic su un punto libero: conta l’orario esatto del clic. Le incompatibilità (turni, assenze, sovrapposizioni) sono segnalate in rosso **prima** della conferma.
- Una seduta inserita resta **programmata** finché non registri l’esito: non conta come effettuata.
- “Trova posto” automatico resta disponibile nel menu.

- **Trascina** una seduta per cambiare giorno o ora (l'app controlla subito se il posto va bene).
- **Clic sulla seduta → ✎ Correggi**: nome, “questa è la seduta n. … di …”, tipo (GC, RM…), durata, visita fisiatrica, **elimina** una seduta inserita per errore.
- **Clic su uno spazio libero**: nuovo paziente, paziente in archivio (se è in trattamento aggiunge le sedute che mancano) o lista d'attesa; indichi le **sedute già fatte** e l'app mostra la prossima.

---

## 7. Problemi frequenti
| Cosa vedi | Cosa fare |
|---|---|
| “Configurazione mancante” | `config.js` non compilato: ripeti il punto 3.2 |
| “Server non raggiungibile” | Supabase in pausa dopo una settimana senza uso: pannello Supabase → **Restore project** |
| “Page not found” | Su Netlify è stato caricato lo zip sbagliato o la cartella sbagliata: vedi capitolo 1 |
| “Il database non è ancora aggiornato per l'importazione” | Esegui `aggiornamento-database.sql` (capitolo 4) |
| “Modificato nel frattempo da …” | Un collega ha cambiato lo stesso dato: i dati sono già ricaricati, ripeti |

## 8. Sicurezza

- Non inviare **mai** a nessuno la *secret key*, la chiave *service_role* o la password del database.
- Il pilota è stato verificato con **dati fittizi o nomi sostituiti**. Prima di usarlo con i dati reali dei pazienti serve una valutazione privacy (sede dei dati, contratti con i fornitori).
- Le demo non hanno password: chiunque abbia il link può aprirle.
