# RE-HAND · Opuscoli riabilitazione mano

App per il **Centro Regionale di Chirurgia della Mano – ATS Liguria** (Progetto “RE-HAND more MIND”).
Raccoglie brochure e opuscoli per i pazienti, li tiene aggiornati sulle evidenze scientifiche e li stampa in **A4** da PC o da telefono.

## Cosa fa
- **Libreria di patologie**: dito a scatto, De Quervain, tunnel carpale, tendini estensori, edema/cicatrice/dolore post-operatorio. Se ne aggiungono quante si vuole (“＋ Nuova patologia”, “Duplica”).
- **Due stampati, sempre A4**:
  - *Pieghevole* A4 orizzontale a 3 ante, fronte-retro (stampa “capovolgi sul lato corto”, poi piega in tre).
  - *Opuscolo esercizi* A4 verticale, si impagina da solo: foto, passi numerati, quanto farlo, avvertenze, QR del video, diario settimanale.
- **Ortesi sempre in evidenza**: quale, quando, quanto (ore al giorno), per quanto tempo.
- **Tasto “⟳ Aggiorna”**: mostra le correzioni proposte, con il testo di prima e quello nuovo, il motivo, il livello di evidenza e le fonti. Il fisioterapista sceglie **Sì / No** per ognuna. Le correzioni accettate entrano in automatico nell’opuscolo, finiscono nello *storico* (“cosa è cambiato”) e nella bibliografia, e l’opuscolo è subito pronto da stampare.
- **Avviso 🔔**: all’apertura l’app controlla se ci sono nuove proposte.
- **Funziona offline** e si installa come app su PC, Android e iPhone.

## Da dove arrivano gli aggiornamenti
Le proposte stanno nel file `app/aggiornamenti.json`. Le prepara Claude cercando **solo letteratura peer-reviewed** su Consensus (revisioni Cochrane, revisioni sistematiche, RCT, consensus/linee guida), con le fonti citate. Si possono generare su richiesta oppure con una ricerca automatica periodica (es. mensile). L’app non cambia nulla senza il vostro Sì.

## Pubblicazione (una volta sola)
1. Unire questo ramo in `main`.
2. Su GitHub: *Settings → Pages → Source: GitHub Actions*.
3. L’app sarà su `https://<utente>.github.io/fisioagenda/`: aprirla dal telefono → “Aggiungi a schermata Home”, oppure dal PC (Chrome/Edge) → icona “Installa”.

> Nota: con repository privato, GitHub Pages richiede un piano a pagamento. In alternativa si può usare un qualsiasi hosting web statico (anche intranet aziendale): basta copiare la cartella `app/`.

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
