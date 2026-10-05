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
4. Nell'app, sezione **Configurazione → Utenti**, assegna ai colleghi il ruolo *Operatore* o *Sola consultazione*. I nuovi account partono in sola consultazione.
5. Comunica a ogni collega la password temporanea **di persona**, non per email insieme all'indirizzo del sito. Al primo accesso ognuno la cambia con il pulsante **Password** in alto.

Per disattivare un collega: **Configurazione → Utenti → togli “Attivo”**. L'accesso viene bloccato subito anche sul server.

## 5. Dammi i due dati pubblici (quando vuoi procedere)

Da **Project Settings → API Keys** (o *Data API*) servono:
- **Project URL**, del tipo `https://xxxxxxxx.supabase.co`;
- **Publishable key**, che inizia con `sb_publishable_…`, oppure in alternativa la chiave *anon public*.

Sono dati **pubblici per progetto**: la protezione è data dagli account e dai permessi sul server.
**Non inviare mai** la *secret key*, la chiave *service_role* o la password del database.

Con questi due dati preparo il pacchetto del sito (`npm run build` con `FA_URL` e `FA_KEY`) e lo provo collegato al tuo progetto. La pubblicazione avverrà **solo su tua richiesta**, in un **nuovo** progetto Netlify separato. I siti esistenti non vengono toccati. Dopo la pubblicazione andrà aggiornato il *Site URL* indicato al passo 3.

## Backup e ripristino

Il piano gratuito **non** include backup automatici scaricabili. Procedura consigliata:

- **Settimanale (dall'app, coordinatore):** **Configurazione → Backup → Scarica backup**. Conserva il file `.json` in una cartella sicura.
- **Ripristino:** **Configurazione → Backup → scegli il file**, scrivi `RIPRISTINA` e conferma. Prima del ripristino l'app scarica automaticamente una copia dello stato attuale. Il ripristino sostituisce i dati del servizio per tutti i colleghi; account e storico restano, e il ripristino è registrato nello storico.
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
