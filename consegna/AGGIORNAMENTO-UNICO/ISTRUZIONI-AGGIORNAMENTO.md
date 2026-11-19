# FisioAgenda — aggiornamento unico

Contiene **tutte le modifiche** fatte finora: tabulato mensile, spie e avvisi con la spunta di lettura, pazienti solo con il codice cartella, competenze Linfodrenaggio e Breast unit (e nuove competenze aggiunte dall'amministratore), app installabile su cellulare e PC. **Cancella tutti i pazienti presenti** (restano fisioterapisti, account, orari, ferie, competenze e festività).

Due file, da usare **una volta sola**, in quest'ordine:

| File | Dove va |
|---|---|
| `1-DATABASE-aggiornamento-unico.sql` | Supabase → SQL Editor (un solo copia-incolla) |
| `2-SITO-netlify.zip` | Netlify → fisioagenda-pilota → Deploys (si trascina, senza aprirlo) |

## 0. Copia di sicurezza (consigliata, 1 minuto)
Nell'app: **Impostazioni → Backup → Scarica backup (.json)**. Conserva il file.

## 1. Database (un solo copia-incolla)
1. Sul **PC**, tasto destro su `1-DATABASE-aggiornamento-unico.sql` → **Apri con → Blocco note**.
2. Premi **Ctrl+A** (seleziona tutto) e poi **Ctrl+C** (copia).
3. Apri **supabase.com** → il tuo progetto → **SQL Editor** → **New query**.
4. Clicca nel riquadro bianco e premi **Ctrl+V** (incolla). Il testo è lungo: va bene così, non serve leggerlo.
5. Premi **Run**. Dopo qualche secondo deve comparire **Success**.

> Se Supabase chiede conferma per un'operazione «distruttiva», conferma: è la cancellazione dei pazienti richiesta.

## 2. Sito
app.netlify.com → **fisioagenda-pilota** → **Deploys** → trascina **`2-SITO-netlify.zip`** nel riquadro in fondo, così com'è.

## 3. Apri l'app
Premi **Ctrl+F5** (sul telefono: chiudi la pagina e riaprila).

## 4. Installa l'app su ogni dispositivo
- **PC (Chrome o Edge):** premi **📲 Installa app** in alto (o l'icona *Installa* nella barra dell'indirizzo).
- **Android (Chrome):** **📲 Installa app**, oppure menu **⋮ → Installa app**.
- **iPhone / iPad (Safari):** **Condividi** (quadrato con la freccia) **→ Aggiungi alla schermata Home**.

Da qui in poi, quando ti mando un aggiornamento del solo sito, l'app installata si aggiorna da sola dopo il caricamento su Netlify.
