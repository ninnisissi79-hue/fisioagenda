# Pubblicare la demo FisioAgenda v3 (versione semplice) su Netlify

> Questa versione va caricata in un **terzo progetto Netlify, nuovo e separato**, con un link proprio. **Non** trascinare questo ZIP nei progetti delle due versioni precedenti: li sovrascriveresti.

Il pacchetto da caricare è **`dist/FisioAgenda-v3-netlify.zip`**. Contiene solo due file, nella cartella principale:

| File | A cosa serve |
|---|---|
| `index.html` | La demo completa in un unico file: pagina, stile e programma. Contiene solo dati fittizi. |
| `_headers` | Istruzioni per Netlify: chiede ai motori di ricerca di non indicizzare il sito. I visitatori non lo vedono. |

Non serve nessun altro file. La demo non usa server, database o servizi esterni.

## Passo per passo

1. **Scarica lo ZIP** sul computer. **Non estrarlo**: Netlify accetta direttamente il file ZIP.
2. Apri **https://app.netlify.com** e crea un account gratuito, per esempio con la tua email. Non serve GitHub.
3. Nella pagina principale scegli **“Add new project”** (in alcune versioni si chiama “Add new site”), poi **“Deploy manually”**.
   Se trovi direttamente un riquadro “Drag and drop your project folder here”, puoi usare quello.
4. **Trascina il file `FisioAgenda-v3-netlify.zip`** nel riquadro tratteggiato. Il caricamento dura pochi secondi.
5. Netlify assegna un nome casuale, per esempio `https://allegro-gelato-123abc.netlify.app`. Per cambiarlo:
   **Project configuration** (o “Site configuration”) → **Change project name** (o “Change site name”) → scrivi, per esempio, `fisioagenda-semplice-v3`.
   Il link diventa `https://fisioagenda-semplice-v3.netlify.app`, se il nome è libero.
6. **Controlla il link** prima di condividerlo. Aprilo in una finestra di navigazione anonima e verifica che compaiano l'avviso giallo e i dati di esempio.
7. **Condividi il link su WhatsApp.** Testo suggerito:
   > Ti invio la demo di FisioAgenda: https://fisioagenda-semplice-v3.netlify.app
   > Contiene solo dati fittizi: non inserire dati reali. Per un uso migliore aprila da computer o tablet; dal telefono tocca “Apri nel browser”.

Le voci dei menu di Netlify possono cambiare nel tempo: se non trovi una voce, cerca l'equivalente (“Deploys”, “Upload”, “Site settings”).

## Per aggiornare la demo in futuro

Nel **terzo** progetto su Netlify (quello della v3) apri **Deploys** e trascina il nuovo ZIP nel riquadro in fondo alla pagina (“Drag and drop your project output folder here”). **Il link resta lo stesso.**
Per rigenerare lo ZIP dal codice: `npm run build:netlify`.

## Cosa sapere

- **Dati dei visitatori:** ogni visitatore lavora sulla **propria copia**, salvata solo nel suo browser. Nessuno vede le modifiche degli altri, neppure tu, e nessun dato viene inviato a Netlify o ad altri servizi.
- **Perdita dei dati di prova:** le prove si perdono se il visitatore cancella i dati del browser o usa la navigazione anonima. Su iPhone, Safari può cancellarle se il sito non viene aperto per alcuni giorni. Il pulsante **“Ripristina esempi”** riporta tutto ai dati iniziali, sempre dopo una conferma.
- **noindex non vuol dire privato:** la direttiva chiede ai motori di ricerca, come Google, di non mostrare il sito nei risultati. **Chiunque abbia il link può aprire la demo** e inoltrarlo ad altri. Non c'è password.
- **Durata del link:** con un account gratuito il sito resta online finché non lo elimini (in Netlify: Project configuration → Delete project). Un caricamento fatto **senza account** è invece temporaneo.
- **Costi:** il piano gratuito di Netlify è sufficiente per questa demo (circa 230 KB). Verifica sul sito di Netlify i limiti aggiornati del piano gratuito.
- **Anteprima su WhatsApp:** compaiono titolo (“FisioAgenda · Demo”) e descrizione. Non c'è un'immagine di anteprima, perché richiederebbe di conoscere in anticipo l'indirizzo definitivo del sito: si può aggiungere dopo la pubblicazione.
