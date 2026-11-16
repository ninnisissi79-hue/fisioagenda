# RE-HAND · Opuscoli riabilitazione mano

App per il **Centro Regionale di Chirurgia della Mano – ATS Liguria** (Progetto “RE-HAND more MIND”).
Raccoglie brochure e opuscoli per i pazienti, li tiene aggiornati sulle evidenze scientifiche e li stampa in **A4** da PC o da telefono.

## Cosa fa
- **Libreria di patologie** (14): CRPS tipo 1 e 2, rigidità MF, dito a scatto, De Quervain, tunnel carpale, tendini estensori, edema/cicatrice/dolore post-operatorio, tendini flessori (3 protocolli), TFCC, rizoartrosi, frattura del radio distale, frattura di scafoide, rigidità IFP, Dupuytren. Le nuove sono **bozze** da approvare. Se ne aggiungono quante si vuole (“＋ Nuova patologia”, “Duplica”).
- **Due stampati, sempre A4**:
  - *Pieghevole* A4 orizzontale a 3 ante, fronte-retro (stampa “capovolgi sul lato corto”, poi piega in tre).
  - *Opuscolo esercizi* A4 verticale, si impagina da solo: foto, passi numerati, quanto farlo, avvertenze, QR del video, diario settimanale.
- **Ortesi sempre in evidenza**: quale, quando, quanto (ore al giorno), per quanto tempo.
- **Tasto “⟳ Aggiorna”**: mostra le correzioni proposte, con il testo di prima e quello nuovo, il motivo, il livello di evidenza e le fonti. Il fisioterapista sceglie **Sì / No** per ognuna. Le correzioni accettate entrano in automatico nell’opuscolo, finiscono nello *storico* (“cosa è cambiato”) e nella bibliografia, e l’opuscolo è subito pronto da stampare.
- **Avviso 🔔**: all’apertura l’app controlla se ci sono nuove proposte.
- **Funziona offline** e si installa come app su PC, Android e iPhone.

## Da dove arrivano gli aggiornamenti
Le proposte stanno nel file `app/aggiornamenti.json`. Le prepara Claude cercando **solo letteratura peer-reviewed** su Consensus (revisioni Cochrane, revisioni sistematiche, RCT, consensus/linee guida), con le fonti citate. Si possono generare su richiesta oppure con una ricerca automatica periodica (es. mensile). L’app non cambia nulla senza il vostro Sì.

## Provarla subito sul PC (senza internet)
Scompattare `RE-HAND-app.zip`, aprire la cartella `RE-HAND` e fare doppio clic su `index.html`.

## Metterla online (una volta sola)
Il repository è privato: GitHub Pages gratis funziona solo con repository pubblico (oppure con GitHub Pro).
1. github.com → repository **fisioagenda** → **Settings** (ingranaggio in alto).
2. In fondo alla pagina *General*, sezione **Danger Zone** → **Change visibility** → **Make public** → conferma.
3. Chiedere a Claude di unire il lavoro nel ramo `main` (oppure aprire e unire la Pull Request).
4. **Settings → Pages** (menu a sinistra) → *Build and deployment* → **Source: GitHub Actions**.
5. Scheda **Actions**: attendere il segno verde “Pubblica app RE-HAND” (1–2 minuti).
6. Aprire `https://ninnisissi79-hue.github.io/fisioagenda/` → sul telefono: Condividi/⋮ → **Aggiungi a schermata Home**; sul PC (Chrome/Edge) icona **Installa** nella barra degli indirizzi.

## Pieghevole: come si piega
Piega “a portafoglio” (roll fold) su A4 orizzontale, fronte-retro *capovolgendo sul lato corto*. L’aletta che si ripiega all’interno è 3 mm più stretta (97 mm contro 100 mm) così si chiude senza incurvarsi; i segnini grigi in alto e in basso indicano le pieghe. Ordine di lettura: copertina → interno copertina + aletta → interno completo; il retro con i contatti resta dietro. Vedi `esempi-pdf/prova-piegatura.png`.

## Disegni
Le illustrazioni sono generate dall’app (file `app/illustr.js`) a partire dagli angoli articolari: sono coerenti, senza problemi di copyright e modificabili. Nell’editor degli esercizi si sceglie il disegno dal menu; una foto vostra, se inserita, ha la precedenza.

## Protocolli alternativi
Un opuscolo può avere più protocolli (es. flessori: Kleinert / attivo precoce / pull-out zona 1). Si sceglie dal menu “Protocollo usato”: cambiano automaticamente ortesi, fasi ed esercizi, e il protocollo è stampato sotto il titolo.

## Dati
Testi, foto e modifiche sono salvati **sul dispositivo** (browser). Da ⚙︎ Impostazioni: *Esporta tutto* per backup o per passare gli opuscoli a un collega, *Importa backup* per ricaricarli. Non inserire dati dei pazienti.

## Struttura
```
app/index.html, app.js, app.css, sheets.css   interfaccia, stampa, editor
app/data/seed.js                              testi originali delle brochure
app/aggiornamenti.json                        proposte di aggiornamento
app/assets/                                   loghi e immagini
esempi-pdf/                                   PDF di esempio generati dall’app
```
