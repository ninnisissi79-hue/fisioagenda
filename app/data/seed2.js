/* Seconda serie di opuscoli (bozze da revisionare) + disegni per gli opuscoli originali.
   Contenuti preparati su letteratura peer-reviewed (Consensus), linee guida e consensus internazionali:
   le fonti sono nella bibliografia di ogni opuscolo. */
window.SEED_VERSION = 2;
(function () {
const C = (u) => "https://consensus.app/papers/details/" + u + "/?utm_source=claude_desktop";
const R = (autori, anno, titolo, rivista, id) => ({ testo: `${autori} (${anno}). ${titolo}. ${rivista}`, url: C(id) });
const STD_E2 = [{ id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" }, { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate", righe: 4 }, { id: "contatti", tipo: "contatti", titolo: "Contattaci" }];
const ST = (t) => [{ data: "2026-11-16", testo: "Bozza creata da Claude su letteratura scientifica, linee guida e consensus (vedi bibliografia). Da revisionare e approvare.", fonte: t || "" }];
const ex = (id, fase, nome, o) => Object.assign({ id, fase, nome, obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }, o);

/* ---------- disegni per gli opuscoli originali ---------- */
const DIS = {
  "dito-a-scatto": { "ex-gliding-base": "gliding-4", "ex-est-assistita": "estensione-ifp", "ex-passiva": "flessione-ifp", "ex-stretch-flessore": "estensione-ifp", "ex-massaggio": "cicatrice", "ex-gliding-avanzato": "gliding", "ex-pallina": "pallina", "ex-pinch": "pinch-moneta", "ex-coordinazione": "pinch-moneta", "ex-stretch-guidato": "estensione-ifp", "ex-funzionali": "presa-bottiglia" },
  "de-quervain": { "ex-mob-pollice": "pollice-flex", "ex-apl-epb-1": "pollice-abd", "ex-ventaglio": "ventaglio", "ex-polso-scarico": "polso-flex-ext-micro", "ex-presa-morbida": "pallina", "ex-educazione": "presa-bottiglia", "ex-apl-epb-2": "pollice-abd", "ex-mob-funzionali": "pinch-moneta", "ex-stretch-pollice": "pollice-flex", "ex-elastico": "polso-flex-ext", "ex-retraining": "presa-bottiglia" },
  "tunnel-carpale": { "ex-gliding": "gliding-3", "ex-automassaggio": "cicatrice", "ex-rinforzo": "pallina", "ex-coordinazione": "pinch-moneta", "ex-sensitiva": "mano-tavolo", "ex-stretching": "polso-flex-ext" },
  "tendini-estensori": { "ex-tutore": "tutore-ifd", "ex-place-hold": "estensione-ifp", "ex-attiva": "flessione-ifp", "ex-cicatrice": "cicatrice", "ex-presa": "pinch-moneta", "ex-rinforzo": "elastico" },
  "edema-cicatrice-dolore": { "ex-elevazione": "elevazione", "ex-polso-gomito": "polso-flex-ext", "ex-massaggio-cicatrice": "cicatrice", "ex-coordinazione": "pinch-moneta" },
};
const COVER = { "tunnel-carpale": "zona-tunnel", "tendini-estensori": "zona-estensori", "edema-cicatrice-dolore": "zona-gonfiore", "dito-a-scatto": "zona-a1", "de-quervain": "zona-dq" };
window.SEED_DOCS.forEach((d) => {
  const m = DIS[d.id] || {}; d.esercizi.forEach((e) => { if (m[e.id]) e.disegno = m[e.id]; });
  if (COVER[d.id]) d.disegno = COVER[d.id];
  d.storico.push({ data: "2026-11-16", testo: "Aggiunti i disegni degli esercizi.", fonte: "" });
});

/* =============================== TENDINI FLESSORI =============================== */
const FLX = {
  id: "tendini-flessori", titolo: "Riabilitazione dopo sutura dei tendini flessori", categoria: "Tendini", aggiornato: "2026-11-16", versione: 1, stato: "bozza",
  immagine: "", disegno: "zona-flessori",
  protocolli: [
    { id: "kleinert", nome: "Kleinert modificato (con Duran)", descrizione: "Tutore dorsale con trazione elastica: l’elastico piega il dito, il paziente lo stende attivamente; si aggiunge la mobilizzazione passiva delle singole articolazioni (Duran). Flessione attiva dalla 4ª–5ª settimana." },
    { id: "attivo", nome: "Mobilizzazione attiva precoce (place & hold / attivo controllato)", descrizione: "Dai primi giorni, nel tutore dorsale: flessione passiva, poi posizionamento e mantenimento attivo (place & hold) o flessione attiva controllata. Richiede una sutura robusta e un paziente affidabile." },
    { id: "pullout", nome: "Zona 1 – reinserzione del profondo con pull-out", descrizione: "Avulsione/lesione del flessore profondo (FDP) in zona 1 reinserita con pull-out (bottone sull’unghia) o ancoretta. Protezione più lunga della punta del dito; il bottone si rimuove su indicazione del chirurgo (di solito verso la 6ª settimana)." }
  ],
  protocollo: "kleinert",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cosa sono i tendini flessori?", testo: "Sono i “cavi” che piegano le dita. Il flessore superficiale (FDS) piega la seconda falange, il profondo (FDP) piega la punta. Scorrono in un canale con delle pulegge.\nDopo la sutura il tendine è debole: se viene sforzato può rompersi; se resta fermo si incolla (aderenze). La riabilitazione lo fa scorrere in sicurezza.", immagine: true },
      { id: "zone", titolo: "Le zone", punti: ["Zona 1: oltre la seconda falange (solo FDP)", "Zona 2: dal palmo alla seconda falange, dentro il canale (FDS + FDP): la più delicata", "Zone 3–5: palmo, tunnel carpale, avambraccio"] }
    ],
    e1: [
      { id: "regole", titolo: "Regole d’oro", punti: ["Il tutore non si toglie mai a casa", "Non usare la mano operata per prendere, stringere o sollevare nulla", "Non piegare le dita con forza e non stenderle con la forza dell’altra mano", "Esercizi poco ma spesso: di solito ogni ora da sveglio", "Mano sollevata per ridurre il gonfiore"] },
      { id: "allarme", titolo: "Segnali di allarme", punti: ["Improvvisamente non riesci più a piegare il dito", "Senti uno “strappo” o uno scatto con dolore", "Ferita arrossata, calda, con secrezioni o febbre"], nota: "In questi casi contatta subito il centro." },
      { id: "pullout-cura", titolo: "Cura del bottone pull-out", protocolli: ["pullout"], punti: ["Tenere il bottone pulito e asciutto", "Non urtarlo e non tirare il filo", "Viene rimosso in ambulatorio su indicazione del chirurgo"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "intervento", titolo: "L’intervento", testo: "Il chirurgo sutura il tendine (zona 2–5) oppure lo reinserisce sull’osso (zona 1, pull-out o ancoretta). Il tipo di sutura e le condizioni della ferita decidono quale protocollo riabilitativo seguire." },
      { id: "perche", titolo: "Perché è così importante la riabilitazione", punti: ["Evita che il tendine si incolli e il dito resti rigido", "Protegge la sutura nelle settimane in cui è più debole (fino a 6–8 settimane)", "Recupera progressivamente movimento, forza e uso della mano"] },
      { id: "evidenze", titolo: "Cosa dicono gli studi", testo: "La mobilizzazione precoce controllata dà meno rotture e un movimento migliore rispetto all’immobilizzazione. Il place & hold attivo ha dato più movimento della sola mobilizzazione passiva, senza più rotture. Tutori lunghi, corti o “relative motion” hanno dato risultati simili." }
    ],
    i2: [
      { id: "ortesi-k", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["kleinert"], campi: { tipo: "Tutore dorsale: polso leggermente piegato, nocche (MF) piegate, dita dritte; elastico dall’unghia al polso", quando: "Sempre, giorno e notte", quanto: "24 ore su 24", durata: "Circa 5–6 settimane continuo, poi solo di notte e nelle situazioni a rischio per 1–2 settimane", note: "Si toglie solo in ambulatorio." } },
      { id: "ortesi-a", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["attivo"], campi: { tipo: "Tutore dorsale di protezione (dall’avambraccio, corto alla mano o “relative motion” secondo il centro)", quando: "Sempre, giorno e notte", quanto: "24 ore su 24", durata: "5 settimane continuo, poi 1 settimana di notte e nelle situazioni a rischio", note: "Gli esercizi si fanno dentro il tutore." } },
      { id: "ortesi-p", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["pullout"], campi: { tipo: "Tutore dorsale con polso e nocche (MF) piegati, punta protetta", quando: "Sempre, giorno e notte", quanto: "24 ore su 24", durata: "Circa 6 settimane (fino alla rimozione del pull-out), poi svezzamento", note: "Proteggere il bottone sull’unghia." } },
      { id: "fase1-k", titolo: "Settimane 0–4", protocolli: ["kleinert"], punti: ["Estensione attiva delle dita contro l’elastico, poi lasciare che l’elastico le pieghi", "Flessione passiva delle singole articolazioni (Duran), con l’altra mano", "Mano sollevata, controllo del gonfiore, cura della ferita"] },
      { id: "fase1-a", titolo: "Settimane 0–4", protocolli: ["attivo"], punti: ["Dai primi giorni dopo l’intervento, nel tutore", "Flessione passiva per “scaldare” il dito", "Place & hold: l’altra mano porta il dito piegato, tu lo tieni da solo qualche secondo", "Flessione attiva leggera fino a metà pugno, se prevista", "Estensione attiva fino al tutore"] },
      { id: "fase1-p", titolo: "Settimane 0–6", protocolli: ["pullout"], punti: ["Flessione passiva delle articolazioni (Duran) nel tutore", "Estensione attiva fino al tutore", "Place & hold leggero solo se indicato dal chirurgo", "Proteggere sempre la punta del dito"] }
    ],
    i3: [
      { id: "fase2", titolo: "Settimane 4–6", protocolli: ["kleinert", "attivo"], punti: ["Flessione attiva completa senza resistenza", "Scorrimento tendineo (gliding)", "Effetto tenodesi del polso, se insegnato"] },
      { id: "fase2-p", titolo: "Dalla rimozione del pull-out (≈ 6 settimane)", protocolli: ["pullout"], punti: ["Flessione attiva della punta (blocking IFD)", "Scorrimento tendineo", "Svezzamento dal tutore"] },
      { id: "fase3", titolo: "Settimane 6–8", punti: ["Svezzamento dal tutore", "Esercizi di blocking (IFP e IFD)", "Estensione completa delle dita; ortesi per la rigidità solo se indicata", "Attività leggere: vestirsi, mangiare, scrivere"] },
      { id: "fase4", titolo: "Settimane 8–12", punti: ["Rinforzo progressivo (pallina morbida, poi più dura)", "Ritorno graduale al lavoro leggero"], nota: "Prese forti, sollevare pesi e sport: di solito non prima di 12 settimane e solo con il via libera." }
    ]
  },
  esercizi: [
    ex("fx-kleinert", "Settimane 0–4", "Estensione attiva contro l’elastico", { protocolli: ["kleinert"], obiettivo: "Far scorrere il tendine senza sforzarlo.", posizione: "Tutore indossato, mano appoggiata.", passi: ["Stendi attivamente le dita fino a toccare il tutore", "Rilassa: l’elastico riporta il dito piegato", "Non piegare mai il dito con i tuoi muscoli"], dosaggio: "10 ripetizioni ogni ora da sveglio", attenzione: "Mai togliere il tutore.", disegno: "kleinert" }),
    ex("fx-duran", "Settimane 0–4", "Flessione passiva delle singole articolazioni (Duran)", { protocolli: ["kleinert", "pullout"], obiettivo: "Mantenere il movimento delle articolazioni e far scorrere i tendini tra loro.", posizione: "Tutore indossato.", passi: ["Con l’altra mano piega la seconda falange tenendo ferma la punta, poi raddrizza", "Piega la punta tenendo ferma la seconda falange, poi raddrizza", "Piega tutto il dito insieme, poi lascia che si stenda fino al tutore"], dosaggio: "10 ripetizioni ogni ora", attenzione: "Delicato, senza dolore.", disegno: "flessione-ifp" }),
    ex("fx-duran-a", "Settimane 0–4", "Flessione passiva di riscaldamento", { protocolli: ["attivo"], obiettivo: "Ridurre la rigidità prima degli esercizi attivi.", posizione: "Tutore indossato.", passi: ["Con l’altra mano piega le dita fino al pugno", "Lascia che si stendano fino al tutore"], dosaggio: "5–10 ripetizioni prima degli esercizi attivi", attenzione: "", disegno: "flessione-ifp" }),
    ex("fx-placehold", "Settimane 0–4", "Place & hold (posiziona e tieni)", { protocolli: ["attivo"], obiettivo: "Attivare il tendine con una forza minima.", posizione: "Tutore indossato, polso nella posizione del tutore.", passi: ["Con l’altra mano porta le dita a pugno", "Togli l’aiuto: tieni le dita piegate da solo, con pochissima forza", "Mantieni 5 secondi, poi rilassa"], dosaggio: "10 ripetizioni ogni ora (o secondo il terapista)", attenzione: "Pochissima forza: solo “tenere”, mai stringere.", disegno: "place-hold" }),
    ex("fx-attiva-ctrl", "Settimane 0–4", "Flessione attiva controllata", { protocolli: ["attivo"], obiettivo: "Iniziare il movimento attivo in sicurezza.", posizione: "Tutore indossato.", passi: ["Piega attivamente le dita lentamente fino a metà pugno (o fino al limite indicato)", "Torna a stendere fino al tutore"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se previsto dal tuo protocollo.", disegno: "gliding-3" }),
    ex("fx-placehold-k", "Settimane 4–6", "Place & hold e flessione attiva leggera", { protocolli: ["kleinert"], obiettivo: "Passare dal movimento passivo a quello attivo.", posizione: "Tutore indossato.", passi: ["Porta le dita a pugno con l’altra mano", "Tienile da solo 5 secondi", "Poi prova a piegarle da solo, lentamente"], dosaggio: "10 ripetizioni ogni ora", attenzione: "", disegno: "place-hold" }),
    ex("fx-tenodesi", "Settimane 4–6", "Effetto tenodesi del polso", { protocolli: ["kleinert", "attivo"], obiettivo: "Far scorrere i tendini sfruttando il movimento del polso.", posizione: "Solo come insegnato in ambulatorio.", passi: ["Polso piegato in giù: le dita si aprono", "Polso in su: le dita si chiudono da sole, senza forza"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se insegnato dal terapista.", disegno: "tenodesi" }),
    ex("fx-gliding", "Settimane 4–6", "Scorrimento tendineo (gliding)", { obiettivo: "Far scorrere separatamente i due tendini flessori.", posizione: "Seduto, gomito appoggiato.", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 4–6 volte al giorno", attenzione: "Senza resistenza.", disegno: "gliding" }),
    ex("fx-blocking-ifp", "Settimane 6–8", "Blocking IFP", { obiettivo: "Far lavorare il flessore superficiale.", posizione: "Mano appoggiata, l’altra mano blocca la prima falange.", passi: ["Tieni ferma la falange vicino al palmo", "Piega solo la seconda falange", "Torna dritto"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "Senza forzare.", disegno: "blocking-ifp" }),
    ex("fx-blocking-ifd", "Settimane 6–8", "Blocking IFD", { obiettivo: "Far lavorare il flessore profondo (la punta).", posizione: "L’altra mano blocca la seconda falange.", passi: ["Tieni ferma la seconda falange", "Piega solo la punta", "Torna dritto"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "blocking-ifd" }),
    ex("fx-estensione", "Settimane 6–8", "Estensione completa delle dita", { obiettivo: "Evitare che il dito resti piegato.", posizione: "Mano appoggiata sul tavolo.", passi: ["Stendi attivamente le dita", "Mantieni qualche secondo"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "Lo stretching passivo forzato solo quando lo autorizza il terapista.", disegno: "estensione-ifp" }),
    ex("fx-pallina", "Settimane 8–12", "Rinforzo progressivo", { obiettivo: "Recuperare la forza di presa.", posizione: "Seduto.", passi: ["Stringi una pallina morbida", "Aumenta la durezza solo se non c’è dolore"], dosaggio: "10 ripetizioni, 2–3 volte al giorno", attenzione: "Prese forti solo con il via libera.", disegno: "pallina" })
  ],
  bibliografia: [
    R("Chesney A. et al.", 2010, "Systematic Review of Flexor Tendon Rehabilitation Protocols in Zone II of the Hand", "Plastic & Reconstructive Surgery", "w:b36a7a39-6b91-4517-834a-df6ef525ffba"),
    R("Trumble T.E. et al.", 2010, "Zone-II Flexor Tendon Repair: A Randomized Prospective Trial of Active Place-and-Hold Therapy Compared with Passive Motion Therapy", "Journal of Bone and Joint Surgery", "w:40f01959-3985-448d-b1ce-3f6c12c54f9f"),
    R("Bamford E. et al.", 2026, "Comparative effectiveness of three splints for rehabilitation after finger flexor tendon repair (FIRST): randomised controlled trial", "BMJ", "w:8d2aaaa6-4eb0-4030-8ae1-fff3f4298c67"),
    R("Wirtz C.D. et al.", 2022, "A retrospective analysis of controlled active motion (CAM) versus modified Kleinert/Duran rehabilitation protocol in flexor tendon repair (zones I and II)", "Archives of Orthopaedic and Trauma Surgery", "w:19b418b0-bd98-4d54-9f98-915a4385f695")
  ],
  storico: ST()
};

/* =============================== TFCC =============================== */
const TFCC = {
  id: "tfcc", titolo: "Riabilitazione – Lesione della TFCC", categoria: "Polso", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-tfcc",
  protocolli: [
    { id: "conservativo", nome: "Trattamento conservativo", descrizione: "Lesione senza instabilità della radio-ulnare distale (DRUJ): ortesi, protezione e riabilitazione progressiva. È la prima scelta; il recupero può richiedere mesi." },
    { id: "chirurgico", nome: "Dopo riparazione artroscopica", descrizione: "Dopo sutura/reinserzione artroscopica: immobilizzazione (spesso sopra il gomito) per 3–6 settimane secondo il chirurgo, poi riabilitazione progressiva." }
  ],
  protocollo: "conservativo",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la TFCC?", testo: "Il complesso della fibrocartilagine triangolare (TFCC) è un insieme di cartilagine e legamenti sul lato del mignolo del polso. Ammortizza i carichi e tiene stabile l’articolazione tra radio e ulna (radio-ulnare distale).", immagine: true },
      { id: "sintomi", titolo: "Sintomi", punti: ["Dolore sul lato del mignolo del polso", "Dolore girando una chiave, svitando, ruotando l’avambraccio", "Dolore appoggiandosi sul palmo (es. alzarsi dalla sedia)", "Click o scatto; a volte sensazione di instabilità", "Minore forza nella presa"] }
    ],
    e1: [
      { id: "evitare", titolo: "Cosa evitare nelle prime settimane", punti: ["Appoggiarsi sul palmo con il polso piegato all’indietro", "Torsioni con carico (strizzare, svitare, cacciaviti)", "Sollevare pesi con il palmo verso il basso", "Sport con racchetta, mazza o appoggio (palestra, yoga)"] },
      { id: "fare", titolo: "Cosa fare", punti: ["Portare l’ortesi come indicato", "Muovere dita, gomito e spalla", "Sollevare gli oggetti con il palmo verso l’alto e vicino al corpo"] },
      { id: "allarme", titolo: "Contatta il centro se", punti: ["Il polso “cede” o senti instabilità", "Il dolore aumenta invece di diminuire", "Formicolio sul mignolo e anulare"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "conservativo", titolo: "Trattamento conservativo", protocolli: ["conservativo"], testo: "È la prima scelta se l’articolazione radio-ulnare è stabile. Si consigliano almeno 6 mesi di trattamento prima di valutare l’intervento.", punti: ["Ortesi per alcune settimane", "Riposo dalle attività che provocano dolore", "Esercizi progressivi e rinforzo dei muscoli stabilizzatori"], nota: "Circa metà dei pazienti guarisce completamente entro un anno: serve pazienza." },
      { id: "chirurgia", titolo: "Quando si opera?", punti: ["Instabilità della radio-ulnare distale", "Lesione completa della “fovea” (inserzione sull’ulna)", "Dolore che non migliora dopo un adeguato trattamento conservativo"], nota: "L’intervento è di solito in artroscopia (sutura o pulizia della lesione)." }
    ],
    i2: [
      { id: "ortesi-c", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["conservativo"], campi: { tipo: "Ortesi su misura che blocca la rotazione dell’avambraccio (con il gomito incluso); nelle forme lievi tutore di polso o fascia ulnare", quando: "Nella fase acuta / dopo il trauma", quanto: "Sempre, togliendola per l’igiene e gli esercizi indicati", durata: "Circa 6 settimane, poi fascia/tutore solo nelle attività a rischio", note: "Nelle lesioni traumatiche, il tutore che include il gomito ha dato risultati migliori di quello solo di polso." } },
      { id: "ortesi-ch", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["chirurgico"], campi: { tipo: "Gesso o ortesi sopra il gomito (blocca la rotazione), poi tutore di polso", quando: "Dopo l’intervento", quanto: "Sempre", durata: "Da 3 a 6 settimane secondo il chirurgo, poi tutore di polso", note: "" } },
      { id: "fase1", titolo: "Fase 1 – Protezione (0–6 settimane)", punti: ["Dita, gomito e spalla liberi: muovili più volte al giorno", "Controllo del gonfiore", "Esercizi del polso solo se indicati"] }
    ],
    i3: [
      { id: "fase2", titolo: "Fase 2 – Movimento (6–8 settimane)", punti: ["Polso su e giù, senza dolore", "Rotazione dell’avambraccio (palmo su / palmo giù), graduale", "Inclinazione verso il mignolo per ultima"] },
      { id: "fase3", titolo: "Fase 3 – Stabilità e forza (8–12 settimane)", punti: ["Rinforzo dei muscoli che stabilizzano il polso (estensore ulnare del carpo, pronatore quadrato)", "Propriocezione: controllo del polso su superfici instabili", "Carico progressivo sul palmo"] },
      { id: "fase4", titolo: "Ritorno alle attività (dopo 3 mesi)", testo: "Sport e lavori pesanti in modo graduale, con fascia ulnare se utile." }
    ]
  },
  esercizi: [
    ex("tf-dita", "Fase 1 – Protezione", "Apri e chiudi la mano", { obiettivo: "Evitare rigidità e gonfiore.", posizione: "Ortesi indossata, mano sollevata.", passi: ["Apri completamente le dita", "Chiudi a pugno"], dosaggio: "10 ripetizioni ogni ora", attenzione: "", disegno: "pugno-apri" }),
    ex("tf-gliding", "Fase 1 – Protezione", "Scorrimento tendineo", { obiettivo: "Mantenere lo scorrimento dei tendini.", posizione: "Ortesi indossata.", passi: ["Dita dritte", "Gancio", "Pugno"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "gliding-3" }),
    ex("tf-polso", "Fase 2 – Movimento", "Polso su e giù", { obiettivo: "Recuperare il movimento del polso.", posizione: "Avambraccio appoggiato sul tavolo, mano oltre il bordo.", passi: ["Porta il polso in giù", "Porta il polso in su"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "Senza dolore.", disegno: "polso-flex-ext" }),
    ex("tf-rotazione", "Fase 2 – Movimento", "Rotazione dell’avambraccio", { obiettivo: "Recuperare la rotazione.", posizione: "Gomito piegato a 90° vicino al fianco.", passi: ["Gira il palmo verso l’alto", "Gira il palmo verso il basso"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "Lentamente, entro il dolore.", disegno: "pronosupinazione" }),
    ex("tf-deviazioni", "Fase 2 – Movimento", "Inclinazioni del polso", { obiettivo: "Recuperare il movimento laterale.", posizione: "Mano appoggiata sul tavolo.", passi: ["Scivola verso il pollice", "Scivola verso il mignolo (per ultimo, senza dolore)"], dosaggio: "10 ripetizioni, 2–3 volte al giorno", attenzione: "", disegno: "deviazioni" }),
    ex("tf-ecu", "Fase 3 – Stabilità e forza", "Rinforzo dei muscoli stabilizzatori", { obiettivo: "Rendere stabile il polso.", posizione: "Avambraccio appoggiato, elastico leggero.", passi: ["Porta il polso in su e un po’ verso il mignolo contro l’elastico", "Torna lentamente"], dosaggio: "2–3 serie da 10", attenzione: "Senza dolore sul lato del mignolo.", disegno: "polso-flex-ext" }),
    ex("tf-carico", "Fase 3 – Stabilità e forza", "Carico progressivo sul palmo", { obiettivo: "Tornare ad appoggiarsi sulla mano.", posizione: "In piedi davanti al tavolo.", passi: ["Appoggia il palmo sul tavolo", "Sposta poco peso sulla mano, poi di più nelle settimane"], dosaggio: "5 × 10 secondi", attenzione: "Fermati se compare dolore.", disegno: "carico-tfcc" })
  ],
  bibliografia: [
    R("Lee J.K. et al.", 2018, "What is the Natural History of the Triangular Fibrocartilage Complex Tear Without Distal Radioulnar Joint Instability?", "Clinical Orthopaedics and Related Research", "w:27c24777-722b-4db6-8651-985143e44d5d"),
    R("Xiao J.-Y. et al.", 2021, "Predictors for poor outcome for conservatively treated traumatic triangular fibrocartilage complex tears", "The Bone & Joint Journal", "w:4edb44d1-67bc-4bdb-b8a0-73f4daa3c17b"),
    R("Paraj D. et al.", 2025, "Comparison of two immobilisation protocols after arthroscopic peripheral TFCC repair: RCT protocol", "BMJ Open", "w:e6eba2c2-7c01-43b6-aedd-b4091dbfe6b0")
  ],
  storico: ST()
};

/* =============================== RIZOARTROSI =============================== */
const RIZO = {
  id: "rizoartrosi", titolo: "Riabilitazione – Rizoartrosi (artrosi alla base del pollice)", categoria: "Artrosi", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-rizo",
  protocolli: [
    { id: "conservativo", nome: "Trattamento conservativo", descrizione: "Educazione e autogestione, esercizi, ortesi; infiltrazione se non basta." },
    { id: "trapeziectomia", nome: "Dopo trapeziectomia", descrizione: "Dopo asportazione del trapezio (con o senza sospensione/interposizione): protezione con ortesi, poi recupero progressivo." }
  ],
  protocollo: "conservativo",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la rizoartrosi?", testo: "È l’artrosi dell’articolazione alla base del pollice (trapezio-metacarpale). È molto frequente, soprattutto nelle donne dopo i 50 anni.", immagine: true },
      { id: "sintomi", titolo: "Sintomi", punti: ["Dolore alla base del pollice", "Dolore nella pinza: girare una chiave, aprire un barattolo, scrivere", "Perdita di forza", "Nel tempo, base del pollice “sporgente” e pollice a Z"] }
    ],
    e1: [
      { id: "proteggi", titolo: "Proteggi l’articolazione", punti: ["Usa prese ampie: impugnature grosse, penne spesse", "Apribarattoli e ausili per chiavi e rubinetti", "Pinza a “O” (pollice tondo), non a “Z”", "Alterna le attività e fai pause"] },
      { id: "cosa-fare", titolo: "Ogni giorno", punti: ["Esercizi brevi più volte al giorno", "Ortesi nelle attività che fanno male", "Calore locale se aiuta"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "conservativo", titolo: "Trattamento conservativo", protocolli: ["conservativo"], testo: "Le linee guida raccomandano un percorso a gradini:", punti: ["Educazione e autogestione (protezione articolare, ausili)", "Esercizi della mano", "Ortesi su misura", "Infiltrazione se i sintomi persistono", "Intervento solo se tutto questo non basta"], nota: "L’ortesi per la base del pollice è raccomandata con forza dalle linee guida americane (ACR) ed europee (EULAR)." },
      { id: "chirurgia", titolo: "L’intervento", testo: "L’intervento più usato è la trapeziectomia (asportazione del trapezio). Le procedure aggiuntive (sospensione con legamento o interposizione) non sembrano dare vantaggi rispetto alla sola trapeziectomia. In casi selezionati si usa una protesi." }
    ],
    i2: [
      { id: "ortesi-c", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["conservativo"], campi: { tipo: "Ortesi rigida su misura per la base del pollice e la MF (trapezio-metacarpale + metacarpo-falangea), IF libera", quando: "Nelle attività che provocano dolore; anche di notte se utile", quanto: "Secondo i sintomi", durata: "Uso continuativo per alcuni mesi: i benefici sulla funzione si vedono a medio termine (3–12 mesi)", note: "" } },
      { id: "ortesi-t", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["trapeziectomia"], campi: { tipo: "Gesso/ortesi polso-pollice (spica), poi ortesi corta per il pollice", quando: "Dopo l’intervento", quanto: "Sempre nelle prime settimane, poi nelle attività", durata: "Circa 4–6 settimane secondo il chirurgo", note: "" } },
      { id: "esercizi-c", titolo: "Esercizi (conservativo)", protocolli: ["conservativo"], punti: ["Stabilizzazione: pinza a “O” controllata", "Rinforzo dei muscoli che aprono e stabilizzano il pollice", "Mobilità del pollice e della mano"], nota: "Esercizi e trattamento combinato riducono il dolore già nei primi 3 mesi." },
      { id: "fase1-t", titolo: "Settimane 0–6", protocolli: ["trapeziectomia"], punti: ["Movimento di dita, gomito e spalla", "Mano sollevata, controllo del gonfiore", "Dalla rimozione del gesso: movimenti attivi dolci del pollice"] }
    ],
    i3: [
      { id: "fase2-t", titolo: "Settimane 6–12", protocolli: ["trapeziectomia"], punti: ["Opposizione e apertura del pollice", "Pinza leggera, poi rinforzo progressivo", "Cura della cicatrice"], nota: "Forza piena: di solito dopo 3–6 mesi." },
      { id: "progressione", titolo: "Come progredire", protocolli: ["conservativo"], punti: ["Settimane 1–4: mobilità e stabilizzazione senza dolore", "Settimane 4–8: rinforzo con elastico/pallina", "Dopo: mantenimento a casa 3 volte a settimana"] },
      { id: "quando-chiamare", titolo: "Quando rivolgersi al centro", punti: ["Dolore che aumenta nonostante ortesi ed esercizi", "Formicolii o gonfiore importante"] }
    ]
  },
  esercizi: [
    ex("rz-o", "Stabilizzazione", "Pinza a “O”", { protocolli: ["conservativo"], obiettivo: "Imparare a usare il pollice in posizione stabile.", posizione: "Mano appoggiata.", passi: ["Tocca la punta dell’indice con la punta del pollice formando una “O” rotonda", "Mantieni 5 secondi senza far cedere la base del pollice"], dosaggio: "10 ripetizioni, 2–3 volte al giorno", attenzione: "Il pollice non deve “collassare” a Z.", disegno: "pinch-moneta" }),
    ex("rz-abd", "Stabilizzazione", "Allontana il pollice contro resistenza", { obiettivo: "Rinforzare i muscoli che stabilizzano la base del pollice.", posizione: "Mano appoggiata, elastico morbido intorno a pollice e indice.", passi: ["Allontana il pollice dall’indice", "Mantieni 3–5 secondi", "Torna lentamente"], dosaggio: "10 ripetizioni, 1–2 volte al giorno", attenzione: "Senza dolore.", disegno: "pollice-abd" }),
    ex("rz-opp", "Mobilità", "Pollice tocca ogni dito", { obiettivo: "Mobilità e coordinazione del pollice.", posizione: "Seduto.", passi: ["Tocca con il pollice la punta di ogni dito, dall’indice al mignolo"], dosaggio: "5 giri, 3 volte al giorno", attenzione: "", disegno: "opposizione" }),
    ex("rz-ventaglio", "Mobilità", "Apertura della mano", { obiettivo: "Mantenere l’ampiezza dello spazio tra pollice e indice.", posizione: "Mano appoggiata.", passi: ["Apri la mano a ventaglio", "Allontana bene il pollice"], dosaggio: "10 ripetizioni", attenzione: "", disegno: "ventaglio" }),
    ex("rz-pallina", "Rinforzo", "Presa con pallina morbida", { obiettivo: "Forza della presa.", posizione: "Seduto.", passi: ["Stringi la pallina con tutta la mano, pollice a “C”"], dosaggio: "2 serie da 10", attenzione: "Solo se non provoca dolore alla base del pollice.", disegno: "pallina" }),
    ex("rz-post-mob", "Dopo il gesso", "Movimenti attivi dolci del pollice", { protocolli: ["trapeziectomia"], obiettivo: "Recuperare il movimento dopo l’intervento.", posizione: "Avambraccio appoggiato.", passi: ["Allontana e avvicina il pollice", "Piega e stendi il pollice"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "Senza forzare.", disegno: "pollice-flex" }),
    ex("rz-cicatrice", "Dopo il gesso", "Massaggio della cicatrice", { protocolli: ["trapeziectomia"], obiettivo: "Cicatrice morbida.", posizione: "Crema idratante.", passi: ["Massaggio circolare sulla cicatrice"], dosaggio: "5 minuti, 2–3 volte al giorno", attenzione: "Solo a ferita chiusa.", disegno: "cicatrice" })
  ],
  bibliografia: [
    R("Gangopadhyay S. et al.", 2025, "Guideline on managing thumb base osteoarthritis: The BSSH Evidence for Surgical Treatment (BEST) findings and recommendations", "Journal of Hand Surgery (European Volume)", "w:4a8b4acb-3fb4-4f71-8b73-2bcf7ddbae72"),
    R("Kolasinski S.L. et al.", 2020, "2019 American College of Rheumatology/Arthritis Foundation Guideline for the Management of Osteoarthritis of the Hand, Hip, and Knee", "Arthritis & Rheumatology", "w:e11fea2e-f5cb-445b-adc6-5d9f2ba2f56a"),
    R("Kloppenburg M. et al.", 2018, "2018 update of the EULAR recommendations for the management of hand osteoarthritis", "Annals of the Rheumatic Diseases", "w:3b78c2a8-8f0e-462d-9e9a-336eec4291db"),
    R("Thakker A. et al.", 2024, "What Are the Most Clinically Effective Nonoperative Interventions for Thumb Carpometacarpal Osteoarthritis? Systematic Review and Network Meta-analysis", "Clinical Orthopaedics and Related Research", "w:3f406539-166d-4b19-bba3-6e0d67ec239a")
  ],
  storico: ST()
};

/* =============================== FRATTURA RADIO DISTALE =============================== */
const RADIO = {
  id: "frattura-radio-distale", titolo: "Riabilitazione – Frattura del radio distale (polso)", categoria: "Fratture", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-radio",
  protocolli: [
    { id: "gesso", nome: "Trattamento in gesso", descrizione: "Frattura composta o ridotta: gesso per circa 4–6 settimane, poi riabilitazione." },
    { id: "placca", nome: "Dopo placca volare", descrizione: "Fissazione con placca: tutore rimovibile per il comfort e movimento precoce del polso se il chirurgo lo consente." }
  ],
  protocollo: "gesso",
  pannelli: {
    cover: [
      { id: "cose", titolo: "La frattura del radio distale", testo: "È la frattura più frequente dell’arto superiore, di solito dopo una caduta sulla mano. Il radio si rompe vicino al polso. Può essere trattata con il gesso o con un intervento (placca).", immagine: true },
      { id: "obiettivi", titolo: "Obiettivi della riabilitazione", punti: ["Ridurre gonfiore e dolore", "Evitare rigidità di dita, gomito e spalla", "Recuperare movimento, forza e uso della mano"] }
    ],
    e1: [
      { id: "subito", titolo: "Da subito", punti: ["Muovi le dita, il gomito e la spalla più volte al giorno", "Mano sollevata sopra il cuore", "Usa la mano per attività leggere se consentito"] },
      { id: "allarme", titolo: "Contatta subito il centro se", punti: ["Dita fredde, bianche o molto gonfie", "Formicolio alle dita che aumenta", "Gesso troppo stretto o che fa male", "Dolore molto forte, sproporzionato, con pelle lucida o cambiamenti di colore"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "gesso-info", titolo: "Il trattamento in gesso", protocolli: ["gesso"], testo: "Il gesso tiene ferma la frattura finché si consolida, di solito 4–6 settimane, con controlli radiografici. Durante il gesso le dita devono muoversi liberamente." },
      { id: "placca-info", titolo: "La placca", protocolli: ["placca"], testo: "La placca rende la frattura stabile. Gli studi mostrano che il movimento precoce del polso dopo placca volare dà, a un anno, più movimento e più forza rispetto a 5 settimane di gesso, senza più complicanze." },
      { id: "casa", titolo: "Esercizi a casa", testo: "Un programma strutturato di esercizi a casa, ben spiegato, è efficace quanto molte sedute: la tua costanza conta più di tutto." }
    ],
    i2: [
      { id: "ortesi-g", tipo: "ortesi", titolo: "Gesso / ortesi", protocolli: ["gesso"], campi: { tipo: "Gesso antibrachio-metacarpale (dita libere), poi eventuale tutore", quando: "Fino alla consolidazione", quanto: "Sempre", durata: "Circa 4–6 settimane secondo il medico", note: "Le nocche (MF) devono restare libere di piegarsi." } },
      { id: "ortesi-p", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["placca"], campi: { tipo: "Tutore di polso rimovibile", quando: "Per il comfort, fuori dagli esercizi", quanto: "Di giorno nelle attività e la notte nelle prime settimane", durata: "Circa 1–2 settimane, poi solo se serve", note: "Toglierlo per gli esercizi se il chirurgo lo consente." } },
      { id: "fase1", titolo: "Fase 1 – Protezione", punti: ["Dita: apri e chiudi, scorrimento tendineo", "Pollice: tocca ogni dito", "Gomito e spalla: movimenti completi", "Placca: polso su e giù e rotazioni dolci dai primi giorni, se consentito"] }
    ],
    i3: [
      { id: "fase2", titolo: "Fase 2 – Movimento (dopo il gesso / dalla 2ª settimana con placca)", punti: ["Polso su e giù, inclinazioni", "Rotazione dell’avambraccio (palmo su / giù)", "Uso della mano nelle attività quotidiane leggere"] },
      { id: "fase3", titolo: "Fase 3 – Forza (dalla 6ª–8ª settimana)", punti: ["Pallina, elastico, piccoli pesi", "Carico progressivo sul palmo", "Ritorno al lavoro e allo sport in modo graduale"], nota: "Il recupero completo richiede spesso 3–6 mesi." }
    ]
  },
  esercizi: [
    ex("rd-dita", "Fase 1 – Protezione", "Apri e chiudi la mano", { obiettivo: "Evitare rigidità e gonfiore delle dita.", posizione: "Mano sollevata.", passi: ["Apri bene le dita", "Chiudi a pugno completo"], dosaggio: "10 ripetizioni ogni ora", attenzione: "", disegno: "pugno-apri" }),
    ex("rd-gliding", "Fase 1 – Protezione", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini delle dita.", posizione: "Gomito appoggiato.", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "", disegno: "gliding" }),
    ex("rd-pollice", "Fase 1 – Protezione", "Pollice tocca ogni dito", { obiettivo: "Mobilità del pollice.", posizione: "", passi: ["Tocca la punta di ogni dito con il pollice"], dosaggio: "5 giri, 4 volte al giorno", attenzione: "", disegno: "opposizione" }),
    ex("rd-polso", "Fase 2 – Movimento", "Polso su e giù", { obiettivo: "Recuperare il movimento del polso.", posizione: "Avambraccio appoggiato, mano oltre il bordo del tavolo.", passi: ["Polso in giù", "Polso in su"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "Con placca: dai primi giorni solo se il chirurgo lo consente.", disegno: "polso-flex-ext" }),
    ex("rd-rotazioni", "Fase 2 – Movimento", "Rotazione dell’avambraccio", { obiettivo: "Recuperare la rotazione.", posizione: "Gomito a 90° vicino al fianco.", passi: ["Palmo verso l’alto", "Palmo verso il basso"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "", disegno: "pronosupinazione" }),
    ex("rd-deviazioni", "Fase 2 – Movimento", "Inclinazioni del polso", { obiettivo: "Movimento laterale del polso.", posizione: "Mano appoggiata sul tavolo.", passi: ["Scivola verso il pollice", "Scivola verso il mignolo"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "deviazioni" }),
    ex("rd-pallina", "Fase 3 – Forza", "Rinforzo della presa", { obiettivo: "Forza.", posizione: "Seduto.", passi: ["Stringi la pallina morbida", "Aumenta la durezza nelle settimane"], dosaggio: "2–3 serie da 10", attenzione: "", disegno: "pallina" }),
    ex("rd-carico", "Fase 3 – Forza", "Carico sul palmo", { obiettivo: "Tornare ad appoggiarsi sulla mano.", posizione: "In piedi davanti al tavolo.", passi: ["Appoggia il palmo e sposta gradualmente il peso"], dosaggio: "5 × 10 secondi", attenzione: "Solo con il via libera del medico.", disegno: "carico-tfcc" })
  ],
  bibliografia: [
    R("Quadlbauer S. et al.", 2021, "Immediate mobilization of distal radius fractures stabilized by volar locking plate results in a better short-term outcome than a five week immobilization: a prospective randomized trial", "Clinical Rehabilitation", "w:7b45a090-b7dd-4459-b4b8-3d1f063aecf4"),
    R("Mehta S.P. et al.", 2024, "Distal Radius Fracture Rehabilitation – Clinical Practice Guidelines", "Journal of Orthopaedic and Sports Physical Therapy", "w:b8aac0e8-28f9-4a4c-9a69-a0f4cc621fd7"),
    R("Handoll H.H.G. et al.", 2015, "Rehabilitation for distal radial fractures in adults", "Cochrane Database of Systematic Reviews", "w:c311b91f-4fd1-432c-959c-18cf5fffa67e")
  ],
  storico: ST()
};

/* =============================== SCAFOIDE =============================== */
const SCAF = {
  id: "frattura-scafoide", titolo: "Riabilitazione – Frattura dello scafoide", categoria: "Fratture", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-scafoide",
  protocolli: [
    { id: "gesso", nome: "Trattamento in gesso", descrizione: "Frattura del corpo (vita) composta o spostata ≤ 2 mm: gesso; se non guarisce, intervento precoce." },
    { id: "vite", nome: "Dopo sintesi con vite", descrizione: "Fissazione con vite: breve protezione, poi movimento; il carico solo a guarigione confermata." }
  ],
  protocollo: "gesso",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Lo scafoide", testo: "È un piccolo osso del polso, dal lato del pollice. Si rompe di solito cadendo sulla mano aperta. Ha una circolazione delicata: per questo può guarire lentamente o non guarire (pseudoartrosi).", immagine: true },
      { id: "sintomi", titolo: "Sintomi", punti: ["Dolore alla base del pollice, nella “tabacchiera anatomica”", "Dolore nella presa e appoggiandosi sulla mano", "A volte poco gonfiore: non sottovalutarlo!"] }
    ],
    e1: [
      { id: "importante", titolo: "Importante", punti: ["Rispetta i tempi del gesso: è la protezione della guarigione", "Vieni a tutti i controlli (radiografie o TAC)", "Non fumare: rallenta la guarigione dell’osso", "Niente sport di contatto o carichi fino al via libera"] },
      { id: "allarme", titolo: "Contatta il centro se", punti: ["Gesso stretto, dita fredde o formicolanti", "Dolore che aumenta"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "gesso-info", titolo: "Trattamento in gesso", protocolli: ["gesso"], testo: "Per le fratture del corpo dello scafoide poco o per niente spostate, un grande studio (SWIFFT) ha mostrato che il gesso dà gli stessi risultati della chirurgia, a 1 e a 5 anni, con meno complicanze. Se la frattura non guarisce, si opera subito." },
      { id: "vite-info", titolo: "Intervento con vite", protocolli: ["vite"], testo: "La vite tiene unita la frattura. Permette di muovere prima il polso, ma l’osso ha comunque bisogno di tempo per guarire: niente carichi fino alla conferma con gli esami." }
    ],
    i2: [
      { id: "ortesi-g", tipo: "ortesi", titolo: "Gesso / ortesi", protocolli: ["gesso"], campi: { tipo: "Gesso sotto il gomito (pollice incluso o no secondo il chirurgo)", quando: "Fino alla guarigione", quanto: "Sempre", durata: "In genere 6–10 settimane, finché la guarigione è confermata dagli esami", note: "" } },
      { id: "ortesi-v", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["vite"], campi: { tipo: "Tutore polso-pollice rimovibile", quando: "Dopo l’intervento, fuori dagli esercizi", quanto: "Di giorno nelle attività e di notte", durata: "Circa 2 settimane, poi nelle attività a rischio fino alla guarigione", note: "" } },
      { id: "fase1", titolo: "Durante l’immobilizzazione", punti: ["Muovi dita, gomito e spalla", "Mano sollevata", "Con la vite: movimenti dolci del polso se il chirurgo li consente"] }
    ],
    i3: [
      { id: "fase2", titolo: "Dopo il gesso / tutore", punti: ["Polso su e giù, inclinazioni, rotazioni", "Movimenti del pollice", "Uso della mano nelle attività leggere"] },
      { id: "fase3", titolo: "A guarigione confermata", punti: ["Rinforzo progressivo della presa", "Carico sul palmo graduale"], nota: "Sport di contatto e lavori pesanti: in genere dopo circa 3 mesi, con il via libera." }
    ]
  },
  esercizi: [
    ex("sc-dita", "Durante l’immobilizzazione", "Apri e chiudi la mano", { obiettivo: "Evitare rigidità.", posizione: "Mano sollevata.", passi: ["Apri le dita", "Chiudi a pugno"], dosaggio: "10 ripetizioni ogni ora", attenzione: "", disegno: "pugno-apri" }),
    ex("sc-gliding", "Durante l’immobilizzazione", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini.", posizione: "", passi: ["Dita dritte", "Gancio", "Pugno"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "gliding-3" }),
    ex("sc-polso", "Dopo il gesso", "Polso su e giù", { obiettivo: "Recuperare il movimento.", posizione: "Avambraccio appoggiato.", passi: ["Polso in giù", "Polso in su"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "Senza forzare.", disegno: "polso-flex-ext" }),
    ex("sc-deviazioni", "Dopo il gesso", "Inclinazioni del polso", { obiettivo: "Movimento laterale.", posizione: "Mano sul tavolo.", passi: ["Verso il pollice", "Verso il mignolo"], dosaggio: "10 ripetizioni", attenzione: "", disegno: "deviazioni" }),
    ex("sc-pollice", "Dopo il gesso", "Movimenti del pollice", { obiettivo: "Mobilità del pollice.", posizione: "", passi: ["Allontana e avvicina il pollice", "Tocca ogni dito"], dosaggio: "10 ripetizioni", attenzione: "", disegno: "opposizione" }),
    ex("sc-rotazione", "Dopo il gesso", "Rotazione dell’avambraccio", { obiettivo: "Recuperare la rotazione.", posizione: "Gomito a 90°.", passi: ["Palmo su", "Palmo giù"], dosaggio: "10 ripetizioni", attenzione: "", disegno: "pronosupinazione" }),
    ex("sc-forza", "A guarigione confermata", "Rinforzo della presa", { obiettivo: "Forza.", posizione: "", passi: ["Pallina morbida, poi più dura"], dosaggio: "2–3 serie da 10", attenzione: "Solo dopo conferma della guarigione.", disegno: "pallina" })
  ],
  bibliografia: [
    R("Dias J.J. et al.", 2020, "Surgery versus cast immobilisation for adults with a bicortical fracture of the scaphoid waist (SWIFFT)", "The Lancet", "w:c3443ddc-46b5-4982-b32b-aa56624ccf46"),
    R("Dias J.J. et al.", 2026, "Clinical effectiveness of early surgical fixation versus cast immobilization for adults with a scaphoid waist fracture: five-year follow-up of SWIFFT", "The Bone & Joint Journal", "w:9d74da51-9eb6-488f-8954-20da88f6c850")
  ],
  storico: ST()
};

/* =============================== RIGIDITÀ IFP =============================== */
const IFP = {
  id: "rigidita-ifp", titolo: "Riabilitazione – Rigidità dell’interfalangea prossimale (IFP / IPP)", categoria: "Articolazioni e legamenti", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-ifp",
  protocolli: [
    { id: "acuta", nome: "Distorsione / lesione della placca volare", descrizione: "“Dito slogato”: protezione breve e movimento precoce per prevenire la rigidità." },
    { id: "rigidita", nome: "Rigidità in flessione (contrattura)", descrizione: "Dito che non si stende: ortesi di estensione per molte ore al giorno ed esercizi." }
  ],
  protocollo: "acuta",
  pannelli: {
    cover: [
      { id: "cose", titolo: "L’articolazione IFP", testo: "È l’articolazione centrale del dito. È quella che più facilmente diventa rigida dopo un trauma, una distorsione o un intervento, e il gonfiore può durare mesi.", immagine: true },
      { id: "sintomi", titolo: "Cosa si nota", punti: ["Dito gonfio a “fuso”", "Difficoltà a stendere completamente o a chiudere il pugno", "Dolore nelle prese"] }
    ],
    e1: [
      { id: "edema", titolo: "Il gonfiore", punti: ["Mano sollevata", "Benda autoaderente leggera (Coban) se insegnato", "Movimento frequente"] },
      { id: "evitare", titolo: "Da evitare", punti: ["Stringere forte o forzare il dito con dolore", "Massaggi aggressivi", "Ortesi troppo strette: pelle bianca, dolore o formicolio = toglierla e contattare il centro"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "acuta-info", titolo: "Dopo una distorsione", protocolli: ["acuta"], testo: "Nella maggior parte delle lesioni della placca volare stabili si usa un breve periodo di protezione (tutore o “buddy taping”, il dito legato a quello vicino) e si inizia presto a muovere.", punti: ["Se l’articolazione è instabile: tutore che blocca l’estensione per 2–3 settimane", "Poi movimento attivo completo"] },
      { id: "rigidita-info", titolo: "Se il dito non si stende", protocolli: ["rigidita"], testo: "Per allungare i tessuti serve una tensione dolce mantenuta a lungo: conta il numero di ore al giorno in posizione di allungamento. In uno studio controllato, oltre 20 ore al giorno hanno dato un recupero maggiore (circa 29° in 3 settimane) rispetto a 12 ore (circa 19°)." }
    ],
    i2: [
      { id: "ortesi-a", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["acuta"], campi: { tipo: "Buddy taping o piccolo tutore digitale; se instabile, tutore di blocco dell’estensione", quando: "Di giorno nelle attività, e di notte se indicato", quanto: "Secondo indicazione", durata: "Circa 2–3 settimane", note: "" } },
      { id: "ortesi-r", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["rigidita"], campi: { tipo: "Ortesi digitale di estensione (statica progressiva o elastica in neoprene)", quando: "Giorno e notte, togliendola per gli esercizi", quanto: "Più ore possibile: tra 12 e oltre 20 ore al giorno", durata: "Settimane, con controllo settimanale dei gradi recuperati", note: "Tensione lieve: mai dolore o pelle bianca." } },
      { id: "fase1", titolo: "Esercizi chiave", punti: ["Blocking IFP: piegare solo l’articolazione centrale", "Estensione attiva completa", "Scorrimento tendineo"] }
    ],
    i3: [
      { id: "progressione", titolo: "Come progredire", punti: ["Settimane 1–3: movimento attivo frequente, controllo del gonfiore", "Settimane 3–6: aggiungere stretching dolce e prese leggere", "Dopo 6 settimane: rinforzo e ritorno alle attività"] },
      { id: "nota", testo: "Il gonfiore e la rigidità dell’IFP possono richiedere molti mesi: la costanza con ortesi ed esercizi fa la differenza." }
    ]
  },
  esercizi: [
    ex("ifp-blocking", "Esercizi chiave", "Blocking IFP", { obiettivo: "Recuperare la flessione dell’articolazione centrale.", posizione: "Mano appoggiata, l’altra mano blocca la prima falange.", passi: ["Tieni ferma la falange vicino al palmo", "Piega solo l’articolazione centrale", "Mantieni 3 secondi e torna"], dosaggio: "10 ripetizioni, 4–6 volte al giorno", attenzione: "", disegno: "blocking-ifp" }),
    ex("ifp-est", "Esercizi chiave", "Estensione attiva dell’IFP", { obiettivo: "Recuperare l’estensione.", posizione: "Mano appoggiata sul tavolo.", passi: ["Stendi il dito più che puoi", "Mantieni 5 secondi"], dosaggio: "10 ripetizioni, 4–6 volte al giorno", attenzione: "", disegno: "estensione-ifp" }),
    ex("ifp-gliding", "Esercizi chiave", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini.", posizione: "", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "gliding" }),
    ex("ifp-flex", "Esercizi chiave", "Flessione IFP assistita", { obiettivo: "Aumentare la flessione.", posizione: "", passi: ["Con l’altra mano accompagna la piega dell’articolazione centrale", "Mantieni 10–20 secondi"], dosaggio: "5 ripetizioni, 3 volte al giorno", attenzione: "Tensione dolce, non dolore.", disegno: "flessione-ifp" }),
    ex("ifp-ortesi", "Ortesi", "Come indossare l’ortesi di estensione", { protocolli: ["rigidita"], obiettivo: "Mantenere a lungo il dito in allungamento.", posizione: "", passi: ["Indossa l’ortesi come insegnato", "Controlla la pelle ogni volta che la togli"], dosaggio: "Il più a lungo possibile (12–20+ ore al giorno)", attenzione: "Pelle bianca, dolore o formicolio = allenta e contatta il centro.", disegno: "tutore-ifp" })
  ],
  bibliografia: [
    R("Punsola-Izard V. et al.", 2023, "A Comparison between Two Intervals of Daily Total End Range Time for Treatment of PIP Joint Flexion Contracture Using an Elastic Tension Digital Neoprene Orthosis", "Journal of Clinical Medicine", "w:a72d3d7c-f8c4-4845-921d-7f41fcf98651"),
    R("Punsola-Izard V. et al.", 2023, "A Cadaver Based Comparison of Two Elastic Tension PIP Joint Extension Orthoses with Focus on Force Generation and Pressure Distribution", "Journal of Clinical Medicine", "w:09adb61b-1a59-4ac3-9e6e-66d93d617f70")
  ],
  storico: ST()
};

/* =============================== DUPUYTREN =============================== */
const DUP = {
  id: "dupuytren", titolo: "Riabilitazione – Malattia di Dupuytren", categoria: "Palmo e fascia", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-dupuytren",
  protocolli: [
    { id: "fasciectomia", nome: "Dopo fasciectomia (intervento aperto)", descrizione: "Asportazione chirurgica delle corde: ferita, edema e cicatrice da gestire; movimento precoce." },
    { id: "percutaneo", nome: "Dopo aponeurotomia ad ago o collagenasi", descrizione: "Rottura della corda senza incisione: recupero più rapido, ma più recidive nel tempo." }
  ],
  protocollo: "fasciectomia",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la malattia di Dupuytren?", testo: "Nel palmo si formano noduli e “corde” che, col tempo, tirano le dita verso il palmo (soprattutto anulare e mignolo). Non è dolorosa, ma può impedire di stendere le dita.", immagine: true },
      { id: "trattamenti", titolo: "I trattamenti", punti: ["Aponeurotomia ad ago o collagenasi: si rompe la corda senza tagli", "Fasciectomia: si asporta la corda con un intervento"], nota: "L’intervento dà risultati più duraturi; le tecniche percutanee hanno un recupero più rapido ma più recidive." }
    ],
    e1: [
      { id: "cosa-fare", titolo: "Nei primi giorni", punti: ["Mano sollevata", "Muovi le dita più volte al giorno, senza forzare", "Medicazione pulita e asciutta"] },
      { id: "allarme", titolo: "Contatta il centro se", punti: ["Ferita arrossata, calda, con secrezioni o febbre", "Formicolio o dito freddo", "Dolore e gonfiore che aumentano"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "ortesi-info", titolo: "Serve un tutore?", testo: "Gli studi controllati non hanno mostrato vantaggi nell’uso di routine del tutore notturno dopo l’intervento; anzi, può ridurre un po’ la flessione. Si usa quindi solo se nelle prime settimane si perde l’estensione." },
      { id: "obiettivi", titolo: "Obiettivi", punti: ["Mantenere l’estensione ottenuta", "Recuperare la flessione completa (pugno)", "Cicatrice morbida, gonfiore ridotto"] }
    ],
    i2: [
      { id: "ortesi-f", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["fasciectomia"], campi: { tipo: "Ortesi di estensione notturna, solo se necessaria", quando: "Solo se il dito tende a ripiegarsi", quanto: "Di notte", durata: "Secondo l’andamento, rivalutata a ogni controllo", note: "Di routine non è necessaria." } },
      { id: "ortesi-p", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["percutaneo"], campi: { tipo: "Ortesi di estensione notturna", quando: "Di notte, se indicata", quanto: "Di notte", durata: "Alcune settimane, secondo indicazione", note: "Le prove a favore sono limitate." } },
      { id: "fase1", titolo: "Settimane 0–2", punti: ["Apri e chiudi la mano, senza forzare", "Scorrimento tendineo", "Mano sollevata"] }
    ],
    i3: [
      { id: "fase2", titolo: "Settimane 2–6", punti: ["Massaggio della cicatrice a ferita chiusa", "Estensione attiva e blocking", "Prese leggere"] },
      { id: "fase3", titolo: "Dopo 6 settimane", punti: ["Rinforzo della presa", "Ritorno a tutte le attività"], nota: "La malattia può ripresentarsi: controlla le dita e torna se ricominciano a piegarsi." }
    ]
  },
  esercizi: [
    ex("du-pugno", "Settimane 0–2", "Apri e chiudi la mano", { obiettivo: "Recuperare il pugno e l’apertura.", posizione: "Mano sollevata.", passi: ["Apri completamente", "Chiudi a pugno"], dosaggio: "10 ripetizioni ogni ora", attenzione: "Senza forzare la ferita.", disegno: "pugno-apri" }),
    ex("du-gliding", "Settimane 0–2", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini.", posizione: "", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "", disegno: "gliding" }),
    ex("du-est", "Settimane 2–6", "Estensione attiva delle dita", { obiettivo: "Mantenere l’estensione ottenuta.", posizione: "Mano sul tavolo.", passi: ["Stendi le dita più che puoi", "Mantieni 5 secondi"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "", disegno: "estensione-ifp" }),
    ex("du-blocking", "Settimane 2–6", "Blocking IFP", { obiettivo: "Recuperare la flessione dell’articolazione centrale.", posizione: "", passi: ["Blocca la prima falange", "Piega solo l’articolazione centrale"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "blocking-ifp" }),
    ex("du-cicatrice", "Settimane 2–6", "Massaggio della cicatrice", { obiettivo: "Cicatrice morbida.", posizione: "Crema idratante.", passi: ["Massaggio circolare", "Massaggio mentre stendi le dita"], dosaggio: "5 minuti, 2–3 volte al giorno", attenzione: "Solo a ferita chiusa.", disegno: "cicatrice" }),
    ex("du-forza", "Dopo 6 settimane", "Rinforzo della presa", { obiettivo: "Forza.", posizione: "", passi: ["Pallina morbida"], dosaggio: "2 serie da 10", attenzione: "", disegno: "pallina" })
  ],
  bibliografia: [
    R("Rodrigues J.N. et al.", 2015, "Surgery for Dupuytren's contracture of the fingers", "Cochrane Database of Systematic Reviews", "w:10479dfc-12a2-47d3-8d97-1d7a3aa4e0fe"),
    R("Karjalainen V.-L. et al.", 2025, "Progression of Dupuytren Contracture: RCT Comparing Surgery, Needle Fasciotomy, and Collagenase Injection", "Plastic & Reconstructive Surgery", "w:0f6d88fa-50ea-438c-9215-c6f9bc295de5"),
    R("Huisstede B.M.A. et al.", 2017, "Effectiveness of Conservative, Surgical, and Postsurgical Interventions for Trigger Finger, Dupuytren Disease, and De Quervain Disease: A Systematic Review", "Archives of Physical Medicine and Rehabilitation", "w:723cf0d5-af9d-4fc2-9821-1ed63b4c6694")
  ],
  storico: ST()
};

window.SEED_DOCS.push(FLX, TFCC, RIZO, RADIO, SCAF, IFP, DUP);
})();
