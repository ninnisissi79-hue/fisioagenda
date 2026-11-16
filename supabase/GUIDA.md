# Collegare RE-HAND a Supabase (circa 10 minuti)

RE-HAND può stare **dentro un progetto Supabase che usi già** (es. *fisioagenda*) senza toccare le altre app:
- tutte le sue tabelle iniziano con `rehand_`;
- non modifica gli utenti esistenti né le impostazioni di accesso;
- chi usa le altre app **non vede nulla** di RE-HAND finché non lo abiliti tu.

## 1. Eseguire lo script
1. supabase.com → apri il progetto (**fisioagenda**).
2. Menu a sinistra → icona **`>_` SQL Editor** → **New query**
   (scorciatoia: all’indirizzo del progetto aggiungi `/sql/new`).
3. Copia **tutto** il file `supabase/schema.sql`, incollalo, premi **Run**. Deve comparire “Success”.

> Le impostazioni di *Authentication* valgono anche per le altre app: **non cambiarle**.

## 2. Indirizzo dell’app (solo quando sarà online)
Authentication → **URL Configuration** → **Redirect URLs** → **Add URL** → indirizzo dell’app
(es. `https://ninnisissi79-hue.github.io/fisioagenda/`).
Serve solo per i link nelle email (conferma, password dimenticata). Non toccare il *Site URL*: è quello delle altre app.

## 3. I due dati per l’app
Menu → **Project Settings** (ingranaggio) → **API** / *API Keys*:
- **Project URL** (es. `https://abcd1234.supabase.co`)
- **anon public** key (stringa lunga `eyJ…`, oppure *publishable key* `sb_publishable_…`)

> ⚠️ Mai la **service_role** / *secret* key.

Mandali a Claude (li scrive in `app/config.js`, così l’app è collegata per tutti)
oppure, su un solo dispositivo: app → ⚙︎ Impostazioni → *Libreria condivisa* → **Salva e ricollega**.

## 4. Primo accesso
1. Apri RE-HAND → **Accedi** (se hai già un account in una delle altre app usa le stesse credenziali) oppure **Registrati**.
   - Se arriva un’email di conferma, clicca il link e poi torna nell’app e accedi.
   - **Il primo che entra in RE-HAND diventa amministratore**: entra tu per prima.
2. In home: “Il cloud è vuoto” → **Pubblica le brochure**.
3. I colleghi si registrano e restano **in attesa**: in alto compare **👥 Nuovi utenti** → scegli **lettore** o **editor**.

## Aggiornamento del database (se avevi già eseguito lo script)
Quando arriva una nuova funzione che usa il database, basta **rieseguire tutto `schema.sql`** (SQL Editor → New query → incolla → Run): è sicuro, non cancella nulla.

## Chi può fare cosa
| | Amministratrice | Editor | Lettore | In attesa |
|---|---|---|---|---|
| Vedere e stampare | ✓ | ✓ | ✓ | – |
| Personalizzare la stampa per un paziente | ✓ | ✓ | ✓ | – |
| Modificare le brochure | ✓ subito pubblicato | ✓ diventa richiesta | – | – |
| Approvare / rifiutare richieste | ✓ | – | – | – |
| Aggiornamenti scientifici (Sì/No) | ✓ | – | – | – |
| Utenti, impostazioni, loghi, contatti | ✓ | – | – | – |

Ogni modifica pubblicata salva la versione precedente (tabella `rehand_revisioni`).
