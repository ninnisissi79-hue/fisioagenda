# FisioAgenda — istruzioni complete

Questa cartella contiene tutto: le due demo che avevi online, il pilota condiviso (tabulato mensile), gli script del database, le trascrizioni dei tabulati e il codice completo.

| File | Cosa contiene | Dove va |
|---|---|---|
| `1-DEMO-prima-versione-netlify.zip` | La prima demo (dati fittizi, nessun server) | Progetto Netlify **fisioagenda-demo** |
| `2-DEMO-v3-semplice-netlify.zip` | La demo v3 “semplice” (dati fittizi, nessun server) | Progetto Netlify **fisioagenda-semplice-v3** |
| `3-PILOTA-sito-netlify.zip` | Il pilota condiviso, **già collegato al vostro Supabase** (`cihywdeiyrawgcglxbcg`): tabulato mensile, spie, orari | Progetto Netlify **fisioagenda-pilota** (non serve modificare nulla) |
| `4-PILOTA-database/` | `setup-completo.sql` (prima installazione), `aggiornamento-database.sql` (aggiornamento, non tocca i dati), `aggiornamento-e-svuota-pazienti.sql` (aggiornamento + cancella tutti i pazienti, una volta sola), `seed.sql` (dati di esempio fittizi, facoltativo) | Supabase → SQL Editor |
| `5-TRASCRIZIONI-tabulati.zip` | Le trascrizioni dei tabulati di ottobre 2026 (solo archivio: l'importazione è stata tolta) | Non serve caricarle |
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

Il pilota è l'app con archivio comune per tutti i colleghi: il tabulato mensile di ognuno, orari, ferie e sostituzioni. Servono **Supabase** (database, gratuito) e un **nuovo** progetto Netlify.

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
2. Nell'app: **Impostazioni → Utenti e permessi** → assegna il ruolo (Fisioterapista, Operatore/segreteria, Sola consultazione) e collega ogni fisioterapista al suo nome. Per chi fa le veci della segreteria compila **«Agende dei colleghi fino al…»**.
3. Comunica la password temporanea **di persona**; al primo accesso ognuno la cambia.

### 3.4 Fisioterapisti e orari
**Impostazioni → Fisioterapisti** (coordinatore, segreteria, programmatore): aggiungi o togli i colleghi. Le competenze (es. Linfodrenaggio, Breast unit) si gestiscono in **Impostazioni → Competenze e percorsi**. L'orario di ognuno si cambia dal tabulato con il pulsante **Orario**.

---

## 4. Aggiornare un pilota già installato

> **Il vostro caso.** Il pacchetto `3-PILOTA-sito-netlify.zip` è già collegato al vostro database: **non** va estratto né modificato.

1. Supabase → SQL Editor → **New query** → incolla **tutto** uno di questi due file → **Run**. Deve finire con “Success”.
    - `4-PILOTA-database/aggiornamento-database.sql`: tutte le modifiche, **non tocca i dati**. Si può rieseguire quando vuoi.
    - `4-PILOTA-database/aggiornamento-e-svuota-pazienti.sql`: le stesse modifiche **e in più cancella tutti i pazienti**, le loro sedute e lo storico che li riguarda (restano fisioterapisti, account, orari, ferie, competenze e festività). Da usare **una volta sola**, quando vuoi ripartire senza pazienti. Prima, per sicurezza: **Impostazioni → Backup → Scarica backup**.
2. Netlify → progetto **fisioagenda-pilota** → **Deploys** → trascina **solo** `3-PILOTA-sito-netlify.zip`, così com’è (non `FisioAgenda-TUTTO.zip`: darebbe “Pagina non trovata”). Il link resta lo stesso.
3. Apri l’app e premi **Ctrl+F5** (sul telefono: chiudi e riapri la pagina).
4. In seguito, per ripartire di nuovo da zero con i pazienti basta l’app: **Impostazioni → Backup → Svuota pazienti e sedute** (vedi sotto).

---

## 5. Usare il pilota

### Installare l'app sul cellulare e sul PC

FisioAgenda si può **installare come un'app**: icona sulla schermata Home o sul desktop, si apre a schermo intero (senza barra del browser) e **si aggiorna da sola** ogni volta che carichi un nuovo pacchetto su Netlify. Non serve nessuno store. Serve comunque la connessione a internet per vedere e salvare i dati.

- **PC (Chrome o Edge):** apri il link e premi **📲 Installa app** in alto, oppure l'icona *Installa* nella barra dell'indirizzo. La trovi poi nel menu Start (puoi fissarla sulla barra delle applicazioni).
- **Android (Chrome):** **📲 Installa app**, oppure menu **⋮ → Installa app**.
- **iPhone / iPad (Safari):** tocca **Condividi** (quadrato con la freccia) **→ Aggiungi alla schermata Home**. Il pulsante «Installa l'app» nella pagina di accesso lo ricorda.
- Senza rete l'app si apre comunque, ma mostra l'avviso di connessione assente e non salva nulla finché la rete non torna. I dati dei pazienti **non vengono salvati sul dispositivo**.
- Su un computer condiviso premi sempre **Esci** alla fine.

### Pazienti solo con il codice cartella (anonimato)

Ogni paziente si indica **solo con il suo codice cartella** (es. `2026/0153`), mai con nome e cognome: nel tabulato, negli avvisi, nello storico e nei backup compare solo il codice.

- Il codice può avere lettere, cifre e `/ . - _`, al massimo 20 caratteri, e deve contenere **almeno una cifra**: se qualcuno scrive un nome (es. «Mario Rossi»), l'app lo rifiuta e lo spiega. Il controllo lo fa anche il server, quindi vale per tutti.
- **Un codice = un paziente**: se il codice c'è già, l'app lo propone e non crea un doppione (maiuscole, minuscole e spazi non contano).
- Nelle **note** non scrivere nomi né altri dati che permettono di riconoscere il paziente.
- I pazienti già inseriti con il nome restano come sono: per ripartire puliti usa **Svuota pazienti e sedute** (vedi sotto), oppure cambia il codice dalla scheda del paziente (tocca il codice → **Codice cartella**).
- Attenzione: il codice cartella permette comunque, a chi ha accesso alle cartelle, di risalire al paziente. Prima di usare il pilota con pazienti veri serve comunque la valutazione privacy indicata in fondo.

### Il tabulato del mese (come i fogli di carta)

Ogni fisioterapista, appena entra, vede **Oggi**: i suoi pazienti del giorno con le sedute che restano. Dal menu **Tabulato** si apre il foglio del mese, pensato anche per il cellulare.

- **Righe = pazienti** (codice cartella, orario e giorni della settimana), **colonne = giorni**. Nella casella c'è il **numero che scende** come sulla carta: 10, 9, 8 … 1.
- **‹ ›** per andare ai mesi precedenti o successivi, senza limiti; **Oggi** per tornare al mese corrente. Toccando il numero di un giorno in alto si apre la **vista Giorno**.
- Caselle **grigie** = sedute passate (contano da sole: **la presenza non si segna**). **A** = assente. **!** = da ricollocare. Un piccolo orario in alto = quella seduta è a un'ora diversa dal solito.
- **Paziente nuovo:** scrivi il **codice cartella** in una delle **righe vuote** in fondo e premi Invio (o tocca una casella della riga). Si apre la scheda già compilata: giorni della settimana, ora (si scrive a mano, es. 12:20), durata (30, 45, 60 o altro), numero di sedute. Le sedute si mettono da sole nei giorni scelti.

#### Toccare una casella (una seduta)

Pulsanti grandi, nessun trascinamento:

- **Sposta** (giorno e ora) · **Durata** · **Assente** (con o senza recupero in fondo al ciclo) · **Altro fisioterapista** (solo questa, un periodo dal… al…, o tutte le prossime) · **Scambia** con un altro paziente · **Cancella** (solo questa o anche le successive) · **Togli l’assenza** se segnata per errore.
- Dopo ogni modifica compare **Annulla** per qualche secondo.
- Una casella vuota (giorno futuro) aggiunge una seduta a quel paziente.

#### Toccare il codice (il paziente)

Codice cartella · numero di sedute · **Cambia ora dal…** (anche solo per alcuni giorni della settimana) · durata · **passa a un collega dal…** · aggiungi altre sedute · togli le sedute future · **Sospendi** / **Riprendi** / **Concludi**.

Una seduta data a un collega resta nel tabulato del titolare con la **sigla del collega** e lo stesso numero; il collega la vede nel suo tabulato come paziente di un altro.

#### Orario, pause, ortesi, gruppi e progetti

Pulsante **Orario** nel tabulato: per ogni giorno della settimana le fasce (ambulatorio, pausa, **ambulatorio ortesi**, **gruppo**, **progetto**…) con inizio, fine e un nome scritto a mano (es. «Gruppo schiena»; **mai i nomi dei pazienti** nei gruppi). **copia su tutti i giorni feriali**, poi **Vale dal…**: il passato non cambia. **Controlla** mostra prima se qualche paziente resta fuori orario.

Ognuno cambia il **proprio** orario; segreteria, coordinatore e programmatore cambiano quello di tutti. Un'attività di un giorno solo: tocca la giornata nella vista Giorno → **Attività**.

#### Avvisi per il fisioterapista (1° livello)

Quando **un'altra persona** (segreteria, coordinatore…) scrive nel tuo tabulato un **paziente nuovo**, oppure ti **affida un paziente di un collega** (per esempio perché è in malattia), compare un **riquadro rosso** in cima al tuo tabulato e alla pagina **Oggi**, più la campanella rossa in alto con il numero.

- **Un avviso per ogni paziente** e per ogni volta: se te ne affidano tre, vedi tre avvisi.
- In ogni avviso: codice cartella del paziente, **le sedute** (giorno e ora), di chi è il paziente e perché (es. «paziente di Rossi, in malattia»), chi l'ha inserito e quando.
- **Vedi** apre il tabulato del mese con il paziente evidenziato; **Visto** spegne l'avviso (con più avvisi c'è anche **Visti tutti**). Segreteria e coordinatore vedono che l'hai letto (✓✓).
- Quello che scrivi tu nel tuo tabulato non ti manda avvisi; nemmeno spostare le sedute di un paziente che hai già, o una seduta che torna a te dopo una sostituzione.

#### Segreteria, coordinatore, programmatore

- Menu **Trova posto** (cerca il primo posto libero) e **Assenze e sostituzioni**.
- Nel tabulato, **Tutti i colleghi**: una colonna per ogni fisioterapista con l'orario di quel giorno.
- **Ferie / permesso** dal tabulato o da Assenze.
- **Le spie in alto:**
    - **Rossa** (lampeggia): qualcuno ha segnato ferie, permesso o malattia e ci sono **pazienti da ricollocare**. Toccandola si apre l'elenco di quei pazienti.
    - **Gialla** (icona calendario con matita), **avviso di 2° livello**: un **fisioterapista** ha cambiato il proprio tabulato. Si apre l'elenco diviso per tabulato, con **cosa è cambiato** (tipo di modifica, paziente, giorno e ora), chi e quando; **Apri** porta al giorno, **Visto** la spegne (vale solo per te). Non serve intervenire. Le modifiche fatte dalla segreteria non la accendono; segnare un'assenza del paziente nemmeno.
- **Avvisi ai fisioterapisti, con la spunta di lettura:** in **Oggi** e in cima al tabulato di ogni collega vedi gli avvisi che ha ricevuto: **✓ inviato, non ancora letto** oppure **✓✓ letto** con data e ora. La doppia spunta compare da sola, appena il fisioterapista preme «Visto». **Dettagli** mostra l'elenco completo (ultimi 30 giorni).
- **Impostazioni → Fisioterapisti**: aggiungere o togliere colleghi (anche la segreteria).
- **Impostazioni → Utenti e permessi** (coordinatore/programmatore): ruolo di ognuno e, per un fisioterapista che fa le veci della segreteria, **«Agende dei colleghi fino al…»**: fino a quella data può modificare tutte le agende e vede le spie; dopo torna a vedere solo la sua.

#### Competenze e percorsi (amministratore)

**Impostazioni → Competenze e percorsi** (coordinatore e programmatore). Le competenze servono a «Trova posto» e alle sostituzioni per proporre il collega giusto. Ci sono già, tra le altre, **Linfodrenaggio** e **Breast unit**: all'inizio hanno le stesse competenze del Linfedema e si cambiano qui.

- **+ Nuova competenza**: scrivi solo il **nome** (il codice interno si crea da solo).
- Nella stessa finestra, per ogni fisioterapista scegli **– No**, **A abilitato** o **★ specifica** (proposto per primo). Con **Tutti: – / A / ★** li imposti tutti insieme, poi correggi i singoli. **Salva**: tutto in un passo.
- **Modifica** su una competenza: cambi il nome, chi la tratta, oppure la togli dall'uso (non più **Attiva**) senza perdere nulla.
- Nell'elenco vedi quanti la trattano (★ e A). Resta anche la **Tabella competenze** in Impostazioni → Fisioterapisti, per vedere tutto insieme.

#### Svuotare pazienti e sedute (per ripartire da zero)

**Impostazioni → Backup → Svuota pazienti e sedute** (coordinatore/programmatore): scrivi `SVUOTA` e conferma. Prima viene scaricato **in automatico** un file di backup (conservalo). Si cancellano **tutti i pazienti e tutte le sedute**, con lo storico che li riguarda (così non restano vecchi nomi); restano fisioterapisti, account, orari e ferie. Non si può annullare se non ripristinando quel backup.

Tolte in questa versione: l'**importazione dei tabulati da foto** e la **lista d'attesa**.

---

## 6. Problemi frequenti
| Cosa vedi | Cosa fare |
|---|---|
| “Configurazione mancante” | `config.js` non compilato: ripeti il punto 3.2 |
| “Server non raggiungibile” | Supabase in pausa dopo una settimana senza uso: pannello Supabase → **Restore project** |
| “Page not found” | Su Netlify è stato caricato lo zip sbagliato o la cartella sbagliata: vedi capitolo 1 |
| Mancano le spie, gli avvisi o «Svuota pazienti» dà errore | Esegui `aggiornamento-database.sql` (capitolo 4) |
| “Modificato nel frattempo da …” | Un collega ha cambiato lo stesso dato: i dati sono già ricaricati, ripeti |

## 7. Sicurezza

- Non inviare **mai** a nessuno la *secret key*, la chiave *service_role* o la password del database.
- Il pilota è stato verificato con **dati fittizi**. I pazienti sono indicati solo con il codice cartella, ma il codice resta un dato personale (pseudonimo): prima di usarlo con i pazienti veri serve una valutazione privacy (sede dei dati, contratti con i fornitori).
- Le demo non hanno password: chiunque abbia il link può aprirle.
