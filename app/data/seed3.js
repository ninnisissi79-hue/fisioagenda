/* Terza serie (bozze da revisionare): CRPS tipo 1 e 2, rigidità della MF. */
window.SEED_VERSION = 3;
(function () {
const C = (u) => "https://consensus.app/papers/details/" + u + "/?utm_source=claude_desktop";
const R = (autori, anno, titolo, rivista, id) => ({ testo: `${autori} (${anno}). ${titolo}. ${rivista}`, url: C(id) });
const STD_E2 = [{ id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" }, { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate", righe: 4 }, { id: "contatti", tipo: "contatti", titolo: "Contattaci" }];
const ST = () => [{ data: "2026-11-16", testo: "Bozza creata da Claude su letteratura scientifica, revisioni Cochrane e linee guida (vedi bibliografia). Da revisionare e approvare.", fonte: "" }];
const ex = (id, fase, nome, o) => Object.assign({ id, fase, nome, obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }, o);

/* =============================== CRPS =============================== */
const CRPS = {
  id: "crps", titolo: "Sindrome dolorosa regionale complessa (CRPS)", categoria: "Dolore", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-crps",
  protocolli: [
    { id: "tipo1", nome: "CRPS tipo 1", descrizione: "Senza una lesione nervosa identificata (es. dopo frattura, intervento, trauma minore)." },
    { id: "tipo2", nome: "CRPS tipo 2", descrizione: "Con una lesione documentata di un nervo periferico: si aggiungono protezione delle zone poco sensibili, rieducazione sensitiva ed eventuale ortesi di supporto." }
  ],
  protocollo: "tipo1",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la CRPS?", testo: "È una condizione in cui, dopo un trauma, una frattura o un intervento, il dolore diventa più forte e dura più a lungo del previsto. Il sistema nervoso diventa “ipersensibile” e amplifica i segnali che arrivano dalla mano.\nCompare in circa il 7% delle fratture degli arti; molti casi migliorano entro il primo anno.", immagine: true },
      { id: "tipo1", titolo: "Tipo 1", protocolli: ["tipo1"], testo: "Non c’è una lesione di un nervo dimostrata." },
      { id: "tipo2", titolo: "Tipo 2", protocolli: ["tipo2"], testo: "C’è una lesione documentata di un nervo (es. mediano, ulnare, radiale). Oltre al dolore possono esserci zone con poca sensibilità o muscoli deboli." }
    ],
    e1: [
      { id: "segni", titolo: "Segni da riconoscere", punti: ["Dolore sproporzionato, bruciore, “scosse”", "Fastidio anche al tocco leggero o al contatto con i vestiti", "Gonfiore; pelle più calda o più fredda, rossa, violacea o pallida", "Sudorazione diversa, pelle lucida, peli e unghie che cambiano", "Rigidità, debolezza, mano che sembra “estranea”"], nota: "Riconoscerla presto e iniziare subito la riabilitazione è importante." },
      { id: "chiamare", titolo: "Contatta il centro se", punti: ["Il dolore aumenta invece di diminuire", "Compaiono cambiamenti di colore o temperatura", "Non riesci più a usare la mano"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "approccio", titolo: "Come si cura", testo: "Il trattamento è multidisciplinare: riabilitazione al centro, con il medico per i farmaci e, se serve, il supporto psicologico per gestire dolore e stress.", punti: ["Usare la mano gradualmente nella vita di tutti i giorni", "Riabilitazione “del cervello”: immagini motorie graduate e specchio", "Desensibilizzazione al tocco", "Controllo del gonfiore", "Esercizio fisico generale (camminare, bicicletta)"] },
      { id: "evidenze", titolo: "Cosa dicono gli studi", testo: "Le prove sono ancora poche e di bassa qualità, ma le revisioni migliori indicano che il programma di immagini motorie graduate e la terapia allo specchio possono ridurre dolore e disabilità." }
    ],
    i2: [
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["tipo1"], campi: { tipo: "Di regola nessuna immobilizzazione; eventuale ortesi di riposo morbida", quando: "Solo per brevi periodi o di notte se il dolore lo richiede", quanto: "Il meno possibile", durata: "Da rivalutare a ogni controllo", note: "Tenere ferma la mano a lungo peggiora la CRPS: il movimento è parte della cura." } },
      { id: "ortesi2", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["tipo2"], campi: { tipo: "Ortesi di supporto solo se il nervo leso causa debolezza (es. polso cadente); altrimenti nessuna immobilizzazione", quando: "Nelle attività in cui serve il supporto", quanto: "Il minimo necessario", durata: "Fino al recupero del nervo, con controlli", note: "Proteggere le zone poco sensibili da tagli e ustioni." } },
      { id: "gmi", titolo: "Immagini motorie graduate (3 tappe)", punti: ["1. Riconoscere mano destra o sinistra in immagini (circa 2 settimane)", "2. Immaginare i movimenti della mano, senza farli (circa 2 settimane)", "3. Terapia allo specchio: muovi la mano sana guardandone il riflesso (circa 2 settimane)"], nota: "Si passa alla tappa successiva solo se il dolore non aumenta." }
    ],
    i3: [
      { id: "ritmo", titolo: "Il giusto ritmo", punti: ["Poco ma spesso, tutti i giorni", "Non fermarti del tutto nei giorni “no” e non esagerare nei giorni buoni", "Aumenta le attività un passo alla volta"] },
      { id: "desens", titolo: "Desensibilizzazione", testo: "Tocca la zona sensibile con tessuti diversi, dal più morbido (seta, cotone) al più ruvido (spugna, velcro), pochi minuti più volte al giorno." },
      { id: "sensitiva", titolo: "Rieducazione sensitiva", protocolli: ["tipo2"], testo: "Se un nervo è leso: esercizi per riconoscere oggetti, forme e consistenze, prima guardando e poi a occhi chiusi." }
    ]
  },
  esercizi: [
    ex("cr-lat", "Tappa 1 – Riconoscere destra e sinistra", "Destra o sinistra?", { obiettivo: "Riattivare la “mappa” della mano nel cervello senza muoverla.", posizione: "Seduto, tranquillo, con foto di mani o un’app dedicata.", passi: ["Guarda la foto di una mano", "Decidi il più rapidamente possibile se è destra o sinistra", "Annota tempo e risposte giuste"], dosaggio: "5–10 minuti, più volte al giorno", attenzione: "Se il dolore aumenta, riduci il tempo.", disegno: "lateralita" }),
    ex("cr-imm", "Tappa 2 – Immaginare il movimento", "Immaginare i movimenti", { obiettivo: "Attivare il movimento “nella mente” senza dolore.", posizione: "Seduto, occhi chiusi o guardando una foto.", passi: ["Guarda una mano in una certa posizione", "Immagina di portare la tua mano nella stessa posizione, senza muoverla", "Torna a rilassarti"], dosaggio: "5–10 minuti, più volte al giorno", attenzione: "", disegno: "immaginazione" }),
    ex("cr-spec", "Tappa 3 – Terapia allo specchio", "Terapia allo specchio", { obiettivo: "Far “vedere” al cervello una mano che si muove senza dolore.", posizione: "Specchio in mezzo al tavolo: la mano malata dietro, nascosta; la mano sana davanti.", passi: ["Guarda il riflesso della mano sana nello specchio", "Muovi lentamente la mano sana (aprire, chiudere, pollice)", "Il riflesso sembra la mano malata che si muove bene"], dosaggio: "5 minuti, più volte al giorno", attenzione: "Senza provocare dolore; togli anelli e orologio.", disegno: "specchio" }),
    ex("cr-desens", "Ogni giorno", "Desensibilizzazione con tessuti", { obiettivo: "Ridurre il fastidio al tocco.", posizione: "Seduto, tessuti diversi a disposizione.", passi: ["Inizia con il tessuto più morbido", "Strofina dalla zona normale verso quella sensibile", "Passa al tessuto successivo quando il fastidio diminuisce"], dosaggio: "2–5 minuti, 3–4 volte al giorno", attenzione: "Fastidio lieve accettabile, non dolore forte.", disegno: "desensibilizzazione" }),
    ex("cr-mov", "Ogni giorno", "Movimento attivo dolce", { obiettivo: "Mantenere il movimento delle dita.", posizione: "Mano sollevata se gonfia.", passi: ["Apri lentamente le dita", "Chiudi a pugno senza forzare"], dosaggio: "10 ripetizioni, più volte al giorno", attenzione: "", disegno: "pugno-apri" }),
    ex("cr-gliding", "Ogni giorno", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini e ridurre la rigidità.", posizione: "", passi: ["Dita dritte", "Gancio", "Pugno"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "gliding-3" }),
    ex("cr-sens", "Rieducazione sensitiva", "Riconoscere oggetti e consistenze", { protocolli: ["tipo2"], obiettivo: "Recuperare la sensibilità dopo la lesione del nervo.", posizione: "Oggetti di forme e materiali diversi.", passi: ["Tocca un oggetto guardandolo", "Ripeti a occhi chiusi e prova a riconoscerlo"], dosaggio: "10 minuti, 2 volte al giorno", attenzione: "Proteggi le zone poco sensibili da caldo e oggetti taglienti.", disegno: "desensibilizzazione" })
  ],
  bibliografia: [
    R("Smart K.M. et al.", 2022, "Physiotherapy for pain and disability in adults with complex regional pain syndrome (CRPS) types I and II", "Cochrane Database of Systematic Reviews", "w:231b821f-fde5-4753-99c8-283621837789"),
    R("Shafiee E. et al.", 2023, "Rehabilitation Interventions for Complex Regional Pain Syndrome: An Overview of Systematic Reviews", "Clinical Journal of Pain", "w:3f53435c-02d4-45e7-a36f-ffb268ccda2f"),
    R("Moseley G.L.", 2006, "Graded motor imagery for pathologic pain", "Neurology", "w:0e7142b2-ee1e-4c1b-94e2-28b6dfa76641"),
    R("Bruehl S.P.", 2015, "Complex regional pain syndrome", "BMJ", "w:8c696669-44c6-4780-992b-86ac661e896b")
  ],
  storico: ST()
};

/* =============================== RIGIDITÀ MF =============================== */
const MF = {
  id: "rigidita-mf", titolo: "Riabilitazione – Rigidità della metacarpo-falangea (MF)", categoria: "Articolazioni e legamenti", aggiornato: "2026-11-16", versione: 1, stato: "bozza", immagine: "", disegno: "zona-mf",
  protocolli: [
    { id: "estensione", nome: "Rigidità in estensione (le nocche non si piegano)", descrizione: "La più frequente: dopo fratture di metacarpi o falangi, immobilizzazione con le nocche dritte, edema dorsale." },
    { id: "flessione", nome: "Rigidità in flessione (le nocche non si stendono)", descrizione: "Meno frequente: dopo traumi palmari, Dupuytren, cicatrici retratte." }
  ],
  protocollo: "estensione",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Le articolazioni MF", testo: "Sono le “nocche”, dove le dita si uniscono alla mano. Dopo una frattura, un intervento o un periodo di immobilizzazione possono diventare rigide: non si piegano o non si stendono più completamente e la presa diventa debole.", immagine: true },
      { id: "perche", titolo: "Perché succede", punti: ["Gonfiore sul dorso della mano", "Immobilizzazione con le nocche dritte", "Aderenze dei tendini e accorciamento dei legamenti"] }
    ],
    e1: [
      { id: "prevenzione", titolo: "Per prevenirla", punti: ["Mano sollevata e movimento frequente delle dita libere", "Nei tutori, nocche piegate (posizione “di sicurezza”) se il chirurgo lo consente", "Iniziare presto gli esercizi indicati"] },
      { id: "allarme", titolo: "Contatta il centro se", punti: ["L’ortesi provoca dolore, formicolio o pelle bianca", "Il gonfiore aumenta"] }
    ],
    e2: STD_E2,
    i1: [
      { id: "principio", titolo: "Il principio", testo: "Per allungare tessuti rigidi serve una tensione dolce mantenuta a lungo. Più tempo la nocca resta al limite del movimento, più si guadagna. Per questo l’ortesi e gli esercizi vanno usati tutti i giorni, per settimane." },
      { id: "evidenze", titolo: "Cosa dicono gli studi", testo: "Le ortesi statiche progressive (regolabili a passi) hanno migliorato movimento, forza e funzione della mano nelle rigidità delle nocche dopo un trauma; le prove sono di livello basso-moderato ma concordi." }
    ],
    i2: [
      { id: "ortesi-e", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["estensione"], campi: { tipo: "Ortesi di flessione delle MF statica progressiva (regolabile) o dinamica, polso libero o in lieve estensione", quando: "Più volte al giorno e/o di notte", quanto: "Sessioni da 20–30 minuti più volte al giorno, aumentando il tempo totale", durata: "Settimane, regolando la tensione a ogni controllo", note: "Tensione lieve: allungamento sì, dolore no." } },
      { id: "ortesi-f", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["flessione"], campi: { tipo: "Ortesi di estensione delle MF statica progressiva o seriale", quando: "Soprattutto di notte, più eventuali sessioni di giorno", quanto: "Il più a lungo possibile, compatibilmente con la pelle", durata: "Settimane, con controlli regolari", note: "Controllare la pelle ogni volta che la togli." } },
      { id: "esercizi", titolo: "Esercizi chiave", punti: ["Piegare le nocche tenendo le dita dritte (posizione “a tavola”)", "Pugno completo partendo dalle nocche", "Scorrimento tendineo", "Stretching dolce mantenuto"] }
    ],
    i3: [
      { id: "progressione", titolo: "Come progredire", punti: ["Settimane 1–3: movimento attivo frequente, gonfiore sotto controllo, ortesi", "Settimane 3–6: stretching mantenuto più lungo, prese leggere", "Dopo 6 settimane: rinforzo e uso pieno della mano"] },
      { id: "nota", testo: "Il calore prima degli esercizi (acqua tiepida) può rendere i tessuti più elastici, se non c’è gonfiore." }
    ]
  },
  esercizi: [
    ex("mf-flex", "Esercizi chiave", "Piegare le nocche (posizione a tavola)", { obiettivo: "Recuperare la flessione delle MF.", posizione: "Gomito appoggiato, mano verso l’alto.", passi: ["Parti con le dita dritte", "Piega solo le nocche tenendo le dita dritte", "Mantieni 5 secondi"], dosaggio: "10 ripetizioni, 4–6 volte al giorno", attenzione: "", disegno: "flessione-mf" }),
    ex("mf-pugno", "Esercizi chiave", "Pugno completo dalle nocche", { protocolli: ["estensione"], obiettivo: "Integrare il movimento delle nocche nel pugno.", posizione: "", passi: ["Piega prima le nocche", "Poi chiudi le dita a pugno", "Aiutati con l’altra mano e mantieni 10–20 secondi"], dosaggio: "5 ripetizioni, 3–4 volte al giorno", attenzione: "Tensione dolce, non dolore.", disegno: "blocking-mf" }),
    ex("mf-est", "Esercizi chiave", "Stendere le nocche", { protocolli: ["flessione"], obiettivo: "Recuperare l’estensione delle MF.", posizione: "Mano appoggiata sul tavolo.", passi: ["Appoggia il palmo e stendi le dita", "Con l’altra mano spingi dolcemente le nocche verso il tavolo", "Mantieni 20–30 secondi"], dosaggio: "5 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "mano-tavolo" }),
    ex("mf-gliding", "Esercizi chiave", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini.", posizione: "", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "", disegno: "gliding" }),
    ex("mf-ortesi", "Ortesi", "Come usare l’ortesi di flessione", { protocolli: ["estensione"], obiettivo: "Mantenere a lungo le nocche al limite del movimento.", posizione: "", passi: ["Indossa l’ortesi come insegnato", "Regola la tensione finché senti un allungamento dolce", "Controlla la pelle quando la togli"], dosaggio: "20–30 minuti più volte al giorno", attenzione: "Dolore, formicolio o pelle bianca = allenta.", disegno: "tutore-flessione-mf" }),
    ex("mf-forza", "Dopo 6 settimane", "Rinforzo della presa", { obiettivo: "Forza.", posizione: "", passi: ["Pallina morbida, poi più dura"], dosaggio: "2 serie da 10", attenzione: "", disegno: "pallina" })
  ],
  bibliografia: [
    R("Wang J. et al.", 2014, "Efficacy of Static Progressive Splinting in the Management of Metacarpophalangeal Joint Stiffness: A Pilot Clinical Trial", "Hong Kong Journal of Occupational Therapy", "w:97b5c3b3-a3be-4d08-beb9-6659c6f86ee8"),
    R("Schwartz D.A.", 2011, "Static Progressive Orthoses for the Upper Extremity: A Comprehensive Literature Review", "Hand", "w:56606a36-bb8f-4f60-8881-b5b7a0e62b49"),
    R("Maher A.A. et al.", 2022, "Hand function response to static progressive splinting in post-burn finger contracture", "Physiotherapy Quarterly", "w:653158dd-5676-4c9a-af4b-0ae57f1c4489"),
    R("Punsola-Izard V. et al.", 2023, "A Comparison between Two Intervals of Daily Total End Range Time for Treatment of PIP Joint Flexion Contracture", "Journal of Clinical Medicine", "w:a72d3d7c-f8c4-4845-921d-7f41fcf98651")
  ],
  storico: ST()
};

window.SEED_DOCS.push(CRPS, MF);
})();
