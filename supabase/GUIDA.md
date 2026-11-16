# Collegare RE-HAND a Supabase (una volta sola, circa 10 minuti)

## 1. Creare il progetto
1. Vai su **supabase.com** → *Start your project* → accedi (anche con GitHub).
2. **New project**:
   - Name: `rehand`
   - Database password: inventane una e conservala
   - Region: **Central EU (Frankfurt)**
3. Attendi 1–2 minuti che il progetto sia pronto.

## 2. Creare le tabelle e le regole di sicurezza
1. Menu a sinistra → **SQL Editor** → **New query**.
2. Apri il file `supabase/schema.sql` di questo repository, copia **tutto** e incollalo.
3. Premi **Run**. Deve comparire “Success”.

## 3. Impostare l’accesso con email
Menu a sinistra → **Authentication** → **Sign In / Providers** → **Email**:
- lascia **Enable Email** attivo;
- disattiva **Confirm email** (più semplice: i colleghi entrano subito dopo la registrazione).

Se preferisci lasciare la conferma via email: **Authentication → URL Configuration → Site URL** = indirizzo dell’app
(es. `https://ninnisissi79-hue.github.io/fisioagenda/`).

## 4. Prendere i due dati per l’app
Menu → **Project Settings** (ingranaggio) → **API** (o *Data API* / *API Keys*):
- **Project URL** (es. `https://abcd1234.supabase.co`)
- **anon public** key (una lunga stringa che inizia con `eyJ…`, oppure la *publishable key* `sb_publishable_…`)

> ⚠️ Non usare e non condividere mai la **service_role** / *secret* key.

## 5. Inserirli nell’app
- **Per tutti (consigliato):** mandali a Claude, che li scrive in `app/config.js`: così l’app pubblicata è già collegata per tutti i colleghi.
- **Solo su un dispositivo:** nell’app → ⚙︎ Impostazioni → *Libreria condivisa (Supabase)* → incolla → **Salva e ricollega**.

## 6. Primo accesso
1. Apri l’app → **Registrati** con la tua email: **il primo utente diventa amministratore**.
2. In home compare “Il cloud è vuoto” → **Pubblica le brochure**.
3. I colleghi si registrano: entrano come **lettori**. Da 👤 Admin → **Utenti e permessi** scegli chi è **editor**.

## Chi può fare cosa
| | Amministratrice | Editor | Lettore |
|---|---|---|---|
| Vedere e stampare | ✓ | ✓ | ✓ |
| **Personalizzare la stampa per un paziente** | ✓ | ✓ | ✓ |
| Modificare le brochure | ✓ subito pubblicato | ✓ diventa una richiesta | – |
| Approvare/rifiutare richieste | ✓ | – | – |
| Aggiornamenti scientifici (Sì/No) | ✓ | – | – |
| Utenti, impostazioni, loghi, contatti | ✓ | – | – |

Ogni modifica pubblicata salva automaticamente la versione precedente (tabella `revisioni`).
