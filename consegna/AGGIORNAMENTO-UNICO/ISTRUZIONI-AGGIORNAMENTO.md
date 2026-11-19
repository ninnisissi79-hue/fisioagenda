# FisioAgenda — aggiornamento unico (anche dal telefono)

Contiene **tutte le modifiche** fatte finora: tabulato mensile, spie e avvisi con la spunta di lettura, pazienti solo con il codice cartella, competenze Linfodrenaggio e Breast unit (e nuove competenze aggiunte dall'amministratore), app installabile su cellulare e PC. **Cancella tutti i pazienti presenti** (restano fisioterapisti, account, orari, ferie, competenze e festività).

| File | Dove va |
|---|---|
| `2-SITO-netlify.zip` | Netlify → fisioagenda-pilota → Deploys |
| `1-DATABASE-comando-corto.sql` | Supabase → SQL Editor (poche righe da copiare) |

## 1. Prima il sito
app.netlify.com → **fisioagenda-pilota** → **Deploys** → nel riquadro in fondo trascina **`2-SITO-netlify.zip`** (dal telefono: tocca **browse to upload** e scegli il file). Aspetta che compaia **Published**.

## 2. Poi il database: un comando corto
1. Apri `1-DATABASE-comando-corto.sql` (sono poche righe) → **Seleziona tutto** → **Copia**.
2. supabase.com → il tuo progetto → **SQL Editor** → **New query** → **incolla** → **Run**.
3. Deve comparire **FATTO: aggiornamento completato e pazienti tolti**. Se Supabase chiede conferma per un'operazione «distruttiva», conferma.

Il comando scarica da solo l'aggiornamento completo dal tuo sito e lo controlla. Se compare **«Aggiornamento non trovato sul sito»**, lo zip non è ancora pubblicato (o l'indirizzo del sito è diverso da `fisioagenda-pilota.netlify.app`): **non è cambiato nulla**, rifai il punto 1 e riprova.

## 3. Apri l'app e installala
Chiudi e riapri la pagina (sul PC **Ctrl+F5**). Poi: **PC / Android** → **📲 Installa app**; **iPhone** → Safari → **Condividi → Aggiungi alla schermata Home**.

> Usa il comando corto **una volta sola**: cancella i pazienti. In alternativa dal PC si può incollare il file completo `1-DATABASE-aggiornamento-unico.sql` (stesso risultato).
