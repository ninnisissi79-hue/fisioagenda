# FisioAgenda pilota — configurazione passo per passo

Servono **un servizio esterno gratuito**, cioè **Supabase** (database, account e aggiornamento in tempo reale), e in un secondo momento, solo se lo chiederai, un sito statico (per esempio un **nuovo** progetto Netlify gratuito).
**Costi: 0 €** con i piani gratuiti. Non attivare piani a pagamento: Supabase Pro costa circa 25 $/mese e non serve per il pilota.

> Le voci dei menu di Supabase cambiano nel tempo: se un nome non corrisponde, cerca la voce equivalente.

## 1. Crea il progetto Supabase (circa 5 minuti)

1. Vai su https://supabase.com e crea un account gratuito. È possibile accedere anche con GitHub.
2. **New project**:
   - **Name:** `fisioagenda-pilota`
   - **Database password:** premi *Generate*, salvala nel tuo gestore di password e **non inviarla a nessuno**, nemmeno a me.
   - **Region:** una regione europea, per esempio *Central EU (Frankfurt)*.
   - **Plan:** Free.
   - Opzioni di sicurezza consigliate (compatibili con il pilota): **Data API attiva**, **RLS automatica attiva**, **esposizione automatica delle nuove tabelle disattivata**. Le autorizzazioni necessarie sono concesse esplicitamente dallo script, solo in lettura per gli utenti autenticati.
3. Attendi che il progetto sia pronto (1–2 minuti).

## 2. Installa il database (2 minuti)

1. Nel progetto apri **SQL Editor → New query**.
2. Copia **tutto** il contenuto di [`supabase/setup-completo.sql`](supabase/setup-completo.sql), incollalo e premi **Run**. Il risultato atteso è “Success. No rows returned”.
   Se avevi già eseguito una versione precedente dello script (senza la parte `20261005000003_grants`), esegui soltanto [`supabase/migrations/20261005000003_grants.sql`](supabase/migrations/20261005000003_grants.sql): si può ripetere senza problemi.
3. Nuova query: copia il contenuto di [`supabase/seed.sql`](supabase/seed.sql) (dati dimostrativi **fittizi**) e premi **Run**.

## 3. Blocca la registrazione libera

1. **Authentication → Sign In / Providers** (o *Providers*): disattiva **Allow new users to sign up**. Lascia attivo il provider *Email*.
2. **Authentication → URL Configuration → Site URL**: per ora lascia il valore attuale; lo aggiorneremo quando ci sarà l'indirizzo del sito.

## 4. Crea gli account (coordinatore e colleghi)

L'email integrata di Supabase invia messaggi solo ai membri del team: per questo gli account si creano con una **password temporanea**.

1. **Authentication → Users → Add user → Create new user**: inserisci l'email, una password temporanea e spunta **Auto Confirm User**.
2. Fai così prima per te, poi per ogni collega.
3. Solo per te, una volta: in **SQL Editor** esegui la riga seguente (con la tua email):
   ```sql
   select app.set_first_admin('tua.email@esempio.it');
   ```
4. Nell'app, sezione **Impostazioni → Utenti e permessi**, assegna ai colleghi il ruolo *Operatore* o *Sola consultazione*. I nuovi account partono in sola consultazione.
5. Comunica a ogni collega la password temporanea **di persona**, non per email insieme all'indirizzo del sito. Al primo accesso ognuno la cambia con il pulsante **Password** in alto.

Per disattivare un collega: **Impostazioni → Utenti e permessi → togli “Attivo”**. L'accesso viene bloccato subito anche sul server.

## 5. Dammi i due dati pubblici (quando vuoi procedere)

Da **Project Settings → API Keys** (o *Data API*) servono:
- **Project URL**, del tipo `https://xxxxxxxx.supabase.co`;
- **Publishable key**, che inizia con `sb_publishable_…`, oppure in alternativa la chiave *anon public*.

Sono dati **pubblici per progetto**: la protezione è data dagli account e dai permessi sul server.
**Non inviare mai** la *secret key*, la chiave *service_role* o la password del database.

Con questi due dati preparo il pacchetto del sito (`npm run build` con `FA_URL` e `FA_KEY`) e lo provo collegato al tuo progetto. La pubblicazione avverrà **solo su tua richiesta**, in un **nuovo** progetto Netlify separato. I siti esistenti non vengono toccati. Dopo la pubblicazione andrà aggiornato il *Site URL* indicato al passo 3.

## Aggiornare un database già installato

Se il database era stato installato con una versione precedente, esegui [`supabase/aggiornamento-database.sql`](supabase/aggiornamento-database.sql) (SQL Editor → New query → incolla → Run). Si può rieseguire senza problemi e non tocca i dati. Per aggiornare e insieme cancellare tutti i pazienti (una volta sola) c'è [`supabase/aggiornamento-e-svuota-pazienti.sql`](supabase/aggiornamento-e-svuota-pazienti.sql).

## Installare l'app sul cellulare e sul PC

FisioAgenda si può **installare come un'app**: icona sulla schermata Home o sul desktop, si apre a schermo intero (senza barra del browser) e **si aggiorna da sola** ogni volta che carichi un nuovo pacchetto su Netlify. Non serve nessuno store. Serve comunque la connessione a internet per vedere e salvare i dati.

- **PC (Chrome o Edge):** apri il link e premi **📲 Installa app** in alto, oppure l'icona *Installa* nella barra dell'indirizzo. La trovi poi nel menu Start (puoi fissarla sulla barra delle applicazioni).
- **Android (Chrome):** **📲 Installa app**, oppure menu **⋮ → Installa app**.
- **iPhone / iPad (Safari):** tocca **Condividi** (quadrato con la freccia) **→ Aggiungi alla schermata Home**. Il pulsante «Installa l'app» nella pagina di accesso lo ricorda.
- Senza rete l'app si apre comunque, ma mostra l'avviso di connessione assente e non salva nulla finché la rete non torna. I dati dei pazienti **non vengono salvati sul dispositivo**.
- Su un computer condiviso premi sempre **Esci** alla fine.

## Pazienti solo con il codice cartella (anonimato)

Ogni paziente si indica **solo con il suo codice cartella** (es. `2026/0153`), mai con nome e cognome: nel tabulato, negli avvisi, nello storico e nei backup compare solo il codice.

- Il codice può avere lettere, cifre e `/ . - _`, al massimo 20 caratteri, e deve contenere **almeno una cifra**: se qualcuno scrive un nome (es. «Mario Rossi»), l'app lo rifiuta e lo spiega. Il controllo lo fa anche il server, quindi vale per tutti.
- **Un codice = un paziente**: se il codice c'è già, l'app lo propone e non crea un doppione (maiuscole, minuscole e spazi non contano).
- Nelle **note** non scrivere nomi né altri dati che permettono di riconoscere il paziente.
- I pazienti già inseriti con il nome restano come sono: per ripartire puliti usa **Svuota pazienti e sedute** (vedi sotto), oppure cambia il codice dalla scheda del paziente (tocca il codice → **Codice cartella**).
- Attenzione: il codice cartella permette comunque, a chi ha accesso alle cartelle, di risalire al paziente. Prima di usare il pilota con pazienti veri serve comunque la valutazione privacy indicata in fondo.

## Il tabulato del mese (come i fogli di carta)

Ogni fisioterapista, appena entra, vede **Oggi**: i suoi pazienti del giorno con le sedute che restano. Dal menu **Tabulato** si apre il foglio del mese, pensato anche per il cellulare.

- **Righe = pazienti** (codice cartella, orario e giorni della settimana), **colonne = giorni**. Nella casella c'è il **numero che scende** come sulla carta: 10, 9, 8 … 1.
- **‹ ›** per andare ai mesi precedenti o successivi, senza limiti; **Oggi** per tornare al mese corrente. Toccando il numero di un giorno in alto si apre la **vista Giorno**.
- Caselle **grigie** = sedute passate (contano da sole: **la presenza non si segna**). **A** = assente. **!** = da ricollocare. Un piccolo orario in alto = quella seduta è a un'ora diversa dal solito.
- **Paziente nuovo:** scrivi il **codice cartella** in una delle **righe vuote** in fondo e premi Invio (o tocca una casella della riga). Si apre la scheda già compilata: giorni della settimana, ora (si scrive a mano, es. 12:20), durata (30, 45, 60 o altro), numero di sedute. Le sedute si mettono da sole nei giorni scelti.

### Toccare una casella (una seduta)

Pulsanti grandi, nessun trascinamento:

- **Sposta** (giorno e ora) · **Durata** · **Assente** (con o senza recupero in fondo al ciclo) · **Altro fisioterapista** (solo questa, un periodo dal… al…, o tutte le prossime) · **Scambia** con un altro paziente · **Cancella** (solo questa o anche le successive) · **Togli l’assenza** se segnata per errore.
- Dopo ogni modifica compare **Annulla** per qualche secondo.
- Una casella vuota (giorno futuro) aggiunge una seduta a quel paziente.

### Toccare il codice (il paziente)

Codice cartella · numero di sedute · **Cambia ora dal…** (anche solo per alcuni giorni della settimana) · durata · **passa a un collega dal…** · aggiungi altre sedute · togli le sedute future · **Sospendi** / **Riprendi** / **Concludi**.

Una seduta data a un collega resta nel tabulato del titolare con la **sigla del collega** e lo stesso numero; il collega la vede nel suo tabulato come paziente di un altro.

### Orario, pause, ortesi, gruppi e progetti

Pulsante **Orario** nel tabulato: per ogni giorno della settimana le fasce (ambulatorio, pausa, **ambulatorio ortesi**, **gruppo**, **progetto**…) con inizio, fine e un nome scritto a mano (es. «Gruppo schiena»; **mai i nomi dei pazienti** nei gruppi). **copia su tutti i giorni feriali**, poi **Vale dal…**: il passato non cambia. **Controlla** mostra prima se qualche paziente resta fuori orario.

Ognuno cambia il **proprio** orario; segreteria, coordinatore e programmatore cambiano quello di tutti. Un'attività di un giorno solo: tocca la giornata nella vista Giorno → **Attività**.

### Avvisi per il fisioterapista (1° livello)

Quando **un'altra persona** (segreteria, coordinatore…) scrive nel tuo tabulato un **paziente nuovo**, oppure ti **affida un paziente di un collega** (per esempio perché è in malattia), compare un **riquadro rosso** in cima al tuo tabulato e alla pagina **Oggi**, più la campanella rossa in alto con il numero.

- **Un avviso per ogni paziente** e per ogni volta: se te ne affidano tre, vedi tre avvisi.
- In ogni avviso: codice cartella del paziente, **le sedute** (giorno e ora), di chi è il paziente e perché (es. «paziente di Rossi, in malattia»), chi l'ha inserito e quando.
- **Vedi** apre il tabulato del mese con il paziente evidenziato; **Visto** spegne l'avviso (con più avvisi c'è anche **Visti tutti**). Segreteria e coordinatore vedono che l'hai letto (✓✓).
- Quello che scrivi tu nel tuo tabulato non ti manda avvisi; nemmeno spostare le sedute di un paziente che hai già, o una seduta che torna a te dopo una sostituzione.

### Segreteria, coordinatore, programmatore

- Menu **Trova posto** (cerca il primo posto libero) e **Assenze e sostituzioni**.
- Nel tabulato, **Tutti i colleghi**: una colonna per ogni fisioterapista con l'orario di quel giorno.
- **Ferie / permesso** dal tabulato o da Assenze.
- **Le spie in alto:**
    - **Rossa** (lampeggia): qualcuno ha segnato ferie, permesso o malattia e ci sono **pazienti da ricollocare**. Toccandola si apre l'elenco di quei pazienti.
    - **Gialla** (icona calendario con matita), **avviso di 2° livello**: un **fisioterapista** ha cambiato il proprio tabulato. Si apre l'elenco diviso per tabulato, con **cosa è cambiato** (tipo di modifica, paziente, giorno e ora), chi e quando; **Apri** porta al giorno, **Visto** la spegne (vale solo per te). Non serve intervenire. Le modifiche fatte dalla segreteria non la accendono; segnare un'assenza del paziente nemmeno.
- **Avvisi ai fisioterapisti, con la spunta di lettura:** in **Oggi** e in cima al tabulato di ogni collega vedi gli avvisi che ha ricevuto: **✓ inviato, non ancora letto** oppure **✓✓ letto** con data e ora. La doppia spunta compare da sola, appena il fisioterapista preme «Visto». **Dettagli** mostra l'elenco completo (ultimi 30 giorni).
- **Impostazioni → Fisioterapisti**: aggiungere o togliere colleghi (anche la segreteria).
- **Impostazioni → Utenti e permessi** (coordinatore/programmatore): ruolo di ognuno e, per un fisioterapista che fa le veci della segreteria, **«Agende dei colleghi fino al…»**: fino a quella data può modificare tutte le agende e vede le spie; dopo torna a vedere solo la sua.

### Competenze e percorsi (amministratore)

**Impostazioni → Competenze e percorsi** (coordinatore e programmatore). Le competenze servono a «Trova posto» e alle sostituzioni per proporre il collega giusto. Ci sono già, tra le altre, **Linfodrenaggio** e **Breast unit**: all'inizio hanno le stesse competenze del Linfedema e si cambiano qui.

- **+ Nuova competenza**: scrivi solo il **nome** (il codice interno si crea da solo).
- Nella stessa finestra, per ogni fisioterapista scegli **– No**, **A abilitato** o **★ specifica** (proposto per primo). Con **Tutti: – / A / ★** li imposti tutti insieme, poi correggi i singoli. **Salva**: tutto in un passo.
- **Modifica** su una competenza: cambi il nome, chi la tratta, oppure la togli dall'uso (non più **Attiva**) senza perdere nulla.
- Nell'elenco vedi quanti la trattano (★ e A). Resta anche la **Tabella competenze** in Impostazioni → Fisioterapisti, per vedere tutto insieme.

### Svuotare pazienti e sedute (per ripartire da zero)

**Impostazioni → Backup → Svuota pazienti e sedute** (coordinatore/programmatore): scrivi `SVUOTA` e conferma. Prima viene scaricato **in automatico** un file di backup (conservalo). Si cancellano **tutti i pazienti e tutte le sedute**, con lo storico che li riguarda (così non restano vecchi nomi); restano fisioterapisti, account, orari e ferie. Non si può annullare se non ripristinando quel backup.

Tolte in questa versione: l'**importazione dei tabulati da foto** e la **lista d'attesa**.

## Backup e ripristino

Il piano gratuito **non** include backup automatici scaricabili. Procedura consigliata:

- **Settimanale (dall'app, coordinatore):** **Impostazioni → Backup → Scarica backup**. Conserva il file `.json` in una cartella sicura.
- **Ripristino:** **Impostazioni → Backup → scegli il file**, scrivi `RIPRISTINA` e conferma. Prima del ripristino l'app scarica automaticamente una copia dello stato attuale. Il ripristino sostituisce i dati del servizio per tutti i colleghi; account e storico restano, e il ripristino è registrato nello storico.
- **Copia completa del database (facoltativa, per chi usa il terminale):** in **Project Settings → Database → Connection string** copia la stringa *Session pooler*, poi:
  ```
  pg_dump "postgresql://postgres.xxxx:PASSWORD@…pooler.supabase.com:5432/postgres" --schema=public --schema=app -Fc -f fisioagenda.dump
  pg_restore --clean --if-exists -d "<stessa stringa>" fisioagenda.dump
  ```
  La password va digitata solo sul tuo computer.

## Se qualcosa non va

- **“Connessione assente”** (banner rosso): le modifiche non vengono salvate. Riprova quando torna la rete; nulla viene mostrato come confermato prima del salvataggio.
- **“Modificato nel frattempo da …”**: un collega ha cambiato lo stesso dato. I dati sono già stati ricaricati: controlla e ripeti.
- **“Il posto è stato appena prenotato da un altro utente”**: ripeti la ricerca.
- **Il sito non si collega dopo una settimana di inattività:** il progetto gratuito è in pausa. Riattivalo dal pannello Supabase con *Restore project*.
