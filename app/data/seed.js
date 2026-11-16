/* Contenuti iniziali: testi delle brochure originali del Centro Regionale di Chirurgia della Mano.
   I testi clinici NON sono stati modificati: gli aggiornamenti si propongono con il tasto "Aggiorna".
   Gli esercizi estesi (passi dettagliati) sono una prima stesura da verificare dal fisioterapista. */
window.SEED_VERSION = 1;
window.SEED_DOCS = [
/* =============================== DITO A SCATTO =============================== */
{
  id: "dito-a-scatto",
  titolo: "Riabilitazione – Dito a scatto",
  categoria: "Tendini",
  aggiornato: "2026-11-16",
  versione: 1,
  immagine: "assets/img/dito-a-scatto.png",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è il dito a scatto?", testo: "Il dito a scatto è una condizione in cui il tendine flessore incontra difficoltà a scorrere nel suo canale, causando un “blocco” o uno scatto durante il movimento.", immagine: true, nota: "Colpisce comunemente pollice, anulare e medio e può limitare le attività quotidiane." }
    ],
    i1: [
      { id: "sintomi", titolo: "Sintomi", punti: ["Scatto o blocco del dito durante la flessione", "Dolore alla base del dito", "Sensazione di “nodo” sul palmo", "Difficoltà ad aprire completamente il dito", "Rigidità mattutina"], nota: "In alcuni casi il dito può rimanere bloccato in flessione." },
      { id: "chirurgia", titolo: "Trattamento chirurgico – quando?", punti: ["Scatto persistente", "Blocco del dito", "Fallimento del trattamento conservativo"], nota: "La procedura chirurgica prevede la liberazione della puleggia A1 per permettere al tendine di scorrere liberamente." }
    ],
    i2: [
      { id: "conservativo", titolo: "Trattamento conservativo – quando?", testo: "Indicato nelle forme iniziali o lievi. Comprende:", punti: ["Riposo relativo", "Uso di tutore notturno in estensione", "Mobilizzazione attiva controllata", "Esercizi di scorrimento tendineo", "Terapie fisiche su prescrizione", "Infiltrazioni corticosteroidee (su indicazione medica)"] },
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "Tutore in estensione del dito", quando: "Di notte (trattamento conservativo)", quanto: "Secondo indicazione del terapista", durata: "Secondo indicazione del terapista", note: "Non modificare o togliere il tutore senza indicazione." } },
      { id: "riab", titolo: "Trattamento riabilitativo", testo: "La riabilitazione è fondamentale per recuperare mobilità completa e prevenire recidive.", punti: ["Ridurre dolore e gonfiore", "Recuperare movimento del dito", "Favorire lo scorrimento tendineo", "Prevenire aderenze", "Ripristinare forza e funzione"] }
    ],
    i3: [
      { id: "protocollo", titolo: "Protocollo", punti: ["Esercizi attivi e passivi", "Scorrimento tendineo (gliding)", "Stretching guidato", "Rinforzo progressivo", "Ritorno alle attività quotidiane"] },
      { id: "fase1", titolo: "1–2 settimana", punti: ["Mobilizzazione attiva e passiva delicata delle dita", "Esercizi di scorrimento tendineo (FDS/FDP)", "Inizio massaggio cicatriziale dal 10° giorno", "Evitare movimenti dolorosi o di forza"] },
      { id: "fase2", titolo: "2–4 settimana", punti: ["Aumento dell’ampiezza di movimento", "Stretching delle dita", "Rinforzo lieve della presa (pallina morbida)", "Controllo di eventuali aderenze tendinee"] },
      { id: "fase3", titolo: "4–6 settimana", punti: ["Rinforzo progressivo", "Ripresa delle attività quotidiane", "Esercizi per destrezza e coordinazione"] }
    ],
    e1: [
      { id: "postop", titolo: "Trattamento post-operatorio", testo: "Dopo intervento o infiltrazione, la gestione precoce è fondamentale per recuperare mobilità e prevenire rigidità o dolore persistente." },
      { id: "obiettivi-iniziali", titolo: "Obiettivi iniziali", punti: ["Ridurre dolore e gonfiore", "Proteggere la ferita chirurgica", "Mantenere la mobilità delle dita", "Prevenire aderenze sul tendine"] },
      { id: "cosa-fare", titolo: "Cosa fare", punti: ["Tenere la mano sollevata nelle prime 48 ore", "Muovere delicatamente tutte le dita ogni ora", "Mantenere la medicazione asciutta", "Applicare ghiaccio protetto se indicato"] },
      { id: "educazione", titolo: "Educazione", testo: "Come evitare i gesti che provocano scatto (presa forte, smartphone stretto, manici sottili)." }
    ],
    e2: [
      { id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" },
      { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate" },
      { id: "contatti", tipo: "contatti", titolo: "Contattaci" }
    ]
  },
  esercizi: [
    { id: "ex-gliding-base", fase: "Fase 1–2 settimane", nome: "Scorrimento tendineo FDS/FDP – livello base", obiettivo: "Far scorrere i tendini flessori nel loro canale e prevenire aderenze.", posizione: "Seduto, gomito appoggiato sul tavolo, mano verso l’alto.", passi: ["Dita dritte", "Posizione a “tavola” (nocche piegate, dita dritte)", "Posizione a “gancio” (nocche dritte, dita piegate)", "Pugno", "Ritorno a dita dritte"], dosaggio: "8–10 ripetizioni, 3–4 volte al giorno", attenzione: "Movimento lento e senza dolore.", foto: "", video: "" },
    { id: "ex-est-assistita", fase: "Fase 1–2 settimane", nome: "Estensione attiva assistita", obiettivo: "Recuperare l’estensione completa del dito.", posizione: "Mano appoggiata sul tavolo.", passi: ["Aprire il dito trattato il più possibile", "Con la mano opposta aiutarlo delicatamente a raddrizzarsi", "Tornare lentamente"], dosaggio: "Secondo indicazione del terapista", attenzione: "Aiuto delicato, mai forzato.", foto: "", video: "" },
    { id: "ex-passiva", fase: "Fase 1–2 settimane", nome: "Mobilizzazione passiva dolce", obiettivo: "Mantenere la mobilità articolare.", posizione: "Seduto, avambraccio appoggiato.", passi: ["Con la mano opposta eseguire piccoli movimenti di flesso-estensione del dito", "Restare entro il comfort"], dosaggio: "Secondo indicazione del terapista", attenzione: "Entro il comfort.", foto: "", video: "" },
    { id: "ex-stretch-flessore", fase: "Fase 1–2 settimane", nome: "Stretching leggero del flessore", obiettivo: "Allungare delicatamente il tendine flessore.", posizione: "Mano appoggiata con il palmo verso l’alto.", passi: ["Portare l’interfalangea prossimale (IFP) in estensione", "Mantenere con il supporto della mano opposta"], dosaggio: "Mantenere 5–8 secondi", attenzione: "Sensazione di allungamento, non di dolore.", foto: "", video: "" },
    { id: "ex-massaggio", fase: "Fase 1–2 settimane", nome: "Massaggio cicatriziale (dal 10° giorno)", obiettivo: "Ammorbidire la cicatrice e prevenire aderenze.", posizione: "Mano appoggiata, crema neutra.", passi: ["Movimenti circolari sulla cicatrice", "Gliding longitudinale sulla zona della puleggia A1"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo a ferita chiusa.", foto: "", video: "" },
    { id: "ex-gliding-avanzato", fase: "Fase 3–6 settimane", nome: "Scorrimento tendineo avanzato (range aumentato)", obiettivo: "Massimo scorrimento tendineo.", posizione: "Come nel livello base.", passi: ["Eseguire la sequenza completa (dita dritte → tavola → gancio → pugno → ritorno)", "Mantenere ogni posizione 2–3 secondi"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-pallina", fase: "Fase 3–6 settimane", nome: "Rinforzo con pallina media", obiettivo: "Recuperare la forza di presa.", posizione: "Seduto, pallina in mano.", passi: ["Presa morbida", "Presa media", "Presa forte"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se indolore.", foto: "", video: "" },
    { id: "ex-pinch", fase: "Fase 3–6 settimane", nome: "Pinch training", obiettivo: "Allenare la pinza pollice–dito.", posizione: "Oggetti piccoli sul tavolo (monete, mollette).", passi: ["Presa pollice–dito leggerissima sull’oggetto", "Spostarlo e rilasciarlo"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-coordinazione", fase: "Fase 3–6 settimane", nome: "Coordinazione fine", obiettivo: "Migliorare destrezza.", posizione: "Seduto al tavolo.", passi: ["Raccogliere perline o spostare piccoli oggetti"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-stretch-guidato", fase: "Fase 3–6 settimane", nome: "Stretching guidato", obiettivo: "Estensione completa del dito.", posizione: "Mano appoggiata.", passi: ["Estensione progressiva di metacarpo-falangea (MF) e IFP", "Stabilizzare con la mano opposta"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-funzionali", fase: "Fase 3–6 settimane", nome: "Attività funzionali", obiettivo: "Ritorno alle attività quotidiane.", posizione: "", passi: ["Aprire bottigliette leggere", "Maneggiare una penna", "Compiti lavorativi protetti"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" }
  ],
  bibliografia: [],
  storico: [ { data: "2026-11-16", testo: "Importata dalla brochure originale (BROCHURE DITO A SCATTO definitiva). Logo ASL 2 sostituito con ATS Liguria.", fonte: "" } ]
},

/* =============================== DE QUERVAIN =============================== */
{
  id: "de-quervain",
  titolo: "Riabilitazione – Tenosinovite di De Quervain",
  categoria: "Tendini",
  aggiornato: "2026-11-16",
  versione: 1,
  immagine: "assets/img/de-quervain.png",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la tenosinovite di De Quervain?", testo: "È una tendinopatia infiammatoria che interessa i tendini dell’Abduttore Lungo del Pollice (APL) e dell’Estensore Breve del Pollice (EPB) e le loro guaine sinoviali nel primo compartimento dorsale del polso.", immagine: true },
      { id: "cose2", testo: "La condizione è caratterizzata da dolore localizzato sul lato radiale del polso, in prossimità della stiloide radiale, soprattutto durante i movimenti di presa, torsione e sollevamento che coinvolgono il pollice.\nÈ frequentemente associata a gesti ripetitivi (lavorativi o sportivi) e, in alcune situazioni, compare in concomitanza a cambiamenti di carico funzionale (ad esempio nelle neo-mamme che sollevano spesso il bambino)." }
    ],
    i1: [
      { id: "sintomi", titolo: "Sintomi", punti: ["Dolore alla base del pollice e sul lato radiale del polso, soprattutto durante l’uso funzionale", "Dolorabilità alla palpazione in corrispondenza del primo compartimento dorsale", "Aumento del dolore con movimenti di presa, torsione (es. aprire un tappo a vite) e sollevamento", "Possibile irradiazione del dolore verso il pollice o l’avambraccio", "Rigidità o fastidio nei movimenti del pollice", "Dolore evocato dal test di Finkelstein"], nota: "I sintomi sono spesso aggravati da attività ripetitive, utilizzo prolungato dello smartphone, gesti di spremitura o torsione e da carichi in presa prolungata." },
      { id: "chirurgia", titolo: "Trattamento chirurgico – quando?", testo: "Si prende in considerazione il trattamento chirurgico quando:", punti: ["Il dolore rimane intenso e invalidante nonostante un adeguato percorso conservativo", "È presente importante limitazione funzionale nelle attività quotidiane", "La sintomatologia è persistente nel tempo e interferisce con il lavoro o lo sport"] },
      { id: "conservativo-quando", titolo: "Trattamento conservativo – quando?", testo: "Il trattamento conservativo rappresenta l’opzione di prima scelta nelle fasi iniziali e moderate della patologia." }
    ],
    i2: [
      { id: "conservativo", titolo: "Può comprendere", punti: ["Riposo funzionale e modifica delle attività che sovraccaricano il polso", "Ortesi di immobilizzazione polso–pollice (thumb spica) su misura", "Terapia fisica antinfiammatoria (su prescrizione medica)", "Terapia manuale specifica per il primo compartimento dorsale", "Esercizi di scivolamento tendineo e mobilizzazione controllata", "Educazione ergonomica e strategie di prevenzione del sovraccarico"] },
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "Ortesi polso–pollice (thumb spica) su misura", quando: "Su indicazione medica, nella fase protetta", quanto: "Dosaggio personalizzato", durata: "Riduzione progressiva dalla 3ª–5ª settimana", note: "" } },
      { id: "fase1", titolo: "1–3 settimana – Fase protetta", punti: ["Crioterapia intermittente 10–12 minuti", "Posizionamento antiedema", "Mobilizzazione attiva e assistita delle dita", "Scivolamenti tendinei APL/EPB dolci, senza evocare il dolore", "Mobilizzazione del polso in piani di scarico", "Terapia manuale delicata (no frizioni profonde nelle prime 2 settimane)", "Ortesi su indicazione medica con dosaggio personalizzato"] }
    ],
    i3: [
      { id: "fase1-nota", testo: "Evidenze recenti mostrano che la mobilizzazione precoce controllata accelera il recupero e riduce rischio di stiffness." },
      { id: "fase2", titolo: "3–5 settimana – Recupero funzionale", punti: ["Riduzione progressiva dell’uso dell’ortesi", "Mobilizzazione attiva in tutti i piani non provocativi", "Rinforzo selettivo APL/EPB", "Re-training dei gesti quotidiani (presa, rotazione, sollevamento)", "Tecniche fasciali e di scorrimento dei tessuti molli", "Educazione alle posture protettive del pollice"], nota: "Studi recenti mostrano che la rieducazione del gesto è fondamentale per la prevenzione delle recidive, soprattutto nei neo-genitori." },
      { id: "fase3", titolo: "5–7 settimana – Fase di forza e ritorno alla funzione", punti: ["Rinforzo progressivo dell’intera catena pollice-polso", "Attività funzionali lavorative, domestiche e sportive", "Coordinazione e resistenza", "Addestramento ergonomico personalizzato"] }
    ],
    e1: [
      { id: "prevenzione", titolo: "Prevenzione recidive", testo: "Il ritorno al lavoro ripetitivo va gestito attraverso progressioni specifiche." },
      { id: "piano", titolo: "Piano riabilitativo personalizzato", testo: "Il percorso riabilitativo verrà adattato alle caratteristiche di ogni paziente, tenendo conto del tipo di intervento, del livello di dolore e delle richieste funzionali." },
      { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate" }
    ],
    e2: [
      { id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" },
      { id: "contatti", tipo: "contatti", titolo: "Contattaci" }
    ]
  },
  esercizi: [
    { id: "ex-mob-pollice", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Mobilizzazione dolce del pollice in piano indolore", obiettivo: "Mantenere la mobilità del pollice senza irritare i tendini.", posizione: "Avambraccio e mano appoggiati sul tavolo, lato del mignolo in basso.", passi: ["Piccole flessioni del pollice", "Piccole estensioni del pollice"], dosaggio: "10 ripetizioni × 3 volte al giorno", attenzione: "Movimenti molto piccoli, senza dolore.", foto: "", video: "" },
    { id: "ex-apl-epb-1", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Scivolamento APL/EPB – livello 1", obiettivo: "Far scorrere i tendini del primo compartimento.", posizione: "Mano appoggiata, polso in posizione neutra.", passi: ["Pollice in linea con il 2° metacarpo", "Lieve abduzione (allontanare il pollice)", "Ritorno"], dosaggio: "Secondo indicazione del terapista", attenzione: "Senza evocare dolore.", foto: "", video: "" },
    { id: "ex-ventaglio", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Apertura mano + “ventaglio lieve”", obiettivo: "Mobilità delle dita.", posizione: "Mano appoggiata.", passi: ["Aprire la mano", "Allargare leggermente le dita a ventaglio", "Richiudere"], dosaggio: "Secondo indicazione del terapista", attenzione: "Senza portare il polso in deviazione ulnare.", foto: "", video: "" },
    { id: "ex-polso-scarico", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Mobilizzazione del polso in scarico", obiettivo: "Mantenere la mobilità del polso.", posizione: "Avambraccio appoggiato sul tavolo, mano fuori dal bordo.", passi: ["Flesso-estensioni del polso di micro-ampiezza"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-presa-morbida", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Mobilizzazione dita + presa morbida", obiettivo: "Mantenere la presa senza sovraccarico.", posizione: "Spugna morbida in mano.", passi: ["Stringere delicatamente la spugna", "Rilasciare"], dosaggio: "Secondo indicazione del terapista", attenzione: "Senza dolore sul lato radiale.", foto: "", video: "" },
    { id: "ex-educazione", fase: "QR 1 – Esercizi base (fase 1–3 settimane)", nome: "Educazione posturale", obiettivo: "Proteggere il pollice nei gesti quotidiani.", posizione: "", passi: ["Imparare a sollevare un oggetto senza “tirare” il pollice"], dosaggio: "", attenzione: "", foto: "", video: "" },
    { id: "ex-apl-epb-2", fase: "Esercizi di recupero (fase 3–5 settimane)", nome: "Scivolamento APL/EPB – livello 2", obiettivo: "Aumentare lo scorrimento tendineo.", posizione: "Come livello 1.", passi: ["Abduzione maggiore del pollice", "Ritorno"], dosaggio: "Secondo indicazione del terapista", attenzione: "Senza evocare dolore.", foto: "", video: "" },
    { id: "ex-mob-funzionali", fase: "Esercizi di recupero (fase 3–5 settimane)", nome: "Mobilizzazioni funzionali", obiettivo: "Recuperare la pinza laterale.", posizione: "Oggetti leggeri sul tavolo.", passi: ["Pinch laterale (pollice contro il lato dell’indice) su oggetti leggeri"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-stretch-pollice", fase: "Esercizi di recupero (fase 3–5 settimane)", nome: "Stretching controllato del pollice", obiettivo: "Allungamento dei tendini APL/EPB.", posizione: "", passi: ["Allungamento lento e controllato"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se indolore.", foto: "", video: "" },
    { id: "ex-elastico", fase: "Esercizi di recupero (fase 3–5 settimane)", nome: "Mobilizzazione del polso con elastico leggero", obiettivo: "Rinforzo del polso.", posizione: "Avambraccio appoggiato, elastico leggero.", passi: ["Flesso-estensione del polso", "Deviazioni del polso"], dosaggio: "Secondo indicazione del terapista", attenzione: "In assenza di dolore.", foto: "", video: "" },
    { id: "ex-retraining", fase: "Esercizi di recupero (fase 3–5 settimane)", nome: "Re-training del gesto da evitare", obiettivo: "Prevenire le recidive.", posizione: "", passi: ["Come aprire un barattolo", "Come sollevare una bottiglia", "Come prendere il bambino"], dosaggio: "", attenzione: "", foto: "", video: "" }
  ],
  bibliografia: [],
  storico: [ { data: "2026-11-16", testo: "Importata dalla brochure originale (BROCHURE DE QUERVAIN definitivo). Logo ASL 2 sostituito con ATS Liguria.", fonte: "" } ]
},

/* =============================== TUNNEL CARPALE =============================== */
{
  id: "tunnel-carpale",
  titolo: "Riabilitazione – Tunnel carpale",
  categoria: "Nervi",
  aggiornato: "2026-11-16",
  versione: 1,
  immagine: "",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cos’è la sindrome del tunnel carpale?", testo: "La sindrome del tunnel carpale (STC) è una neuropatia da compressione del nervo mediano a livello del polso, all’interno di un canale osteofibroso chiamato tunnel carpale.\nLa causa è l’aumento della pressione all’interno di questo spazio, che può derivare da fattori meccanici, posturali o infiammatori.", immagine: true },
      { id: "sintomi", titolo: "Sintomatologia", punti: ["Formicolii e intorpidimento alle prime tre dita e metà del quarto dito", "Dolore notturno che può risvegliare e migliorare scuotendo la mano", "Riduzione della forza di presa e difficoltà nei movimenti fini", "Nei casi avanzati, atrofia dell’eminenza tenar e perdita di sensibilità persistente"] }
    ],
    i1: [
      { id: "chirurgia", titolo: "Trattamento chirurgico, quando?", testo: "L’intervento è indicato quando:", punti: ["La sintomatologia è resistente al trattamento conservativo", "È presente deficit sensitivo o motorio documentato all’esame clinico o all’elettromiografia", "La compressione è cronica o severa e compromette le attività quotidiane o lavorative"] },
      { id: "opzioni", titolo: "Opzioni chirurgiche", testo: "L’obiettivo dell’intervento è decomprimere il nervo mediano mediante la sezione del legamento trasverso del carpo. Le tecniche disponibili sono:", punti: ["Chirurgia a cielo aperto tradizionale", "Chirurgia mini-open (piccola incisione palmare)", "Chirurgia endoscopica, con recupero più rapido ma non indicata in tutti i casi"], nota: "La tecnica sarà concordata insieme al Chirurgo per ottimizzare i risultati in base al quadro clinico del paziente ed alle possibilità di intervento." },
      { id: "conservativo", titolo: "Trattamento conservativo: quando è indicato", testo: "È consigliato nelle forme lievi o iniziali, oppure quando non vi è indicazione chirurgica immediata. Comprende:", punti: ["Tutore notturno in posizione neutra del polso", "Terapia fisica (ultrasuoni, laser, tecar, ionoforesi)", "Esercizi neurodinamici e di scorrimento tendineo", "Educazione ergonomica e modifiche delle attività lavorative"] }
    ],
    i2: [
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "Tutore leggero con polso in posizione neutra", quando: "Soprattutto di notte", quanto: "Secondo indicazione del terapista", durata: "Fino a scomparsa dei sintomi notturni", note: "Evita flessione o estensione eccessiva del polso." } },
      { id: "fase1", titolo: "Settimana 1–3", testo: "Obiettivi:", punti: ["Riduzione del dolore e del gonfiore notturno", "Diminuire la pressione all’interno del tunnel carpale", "Mantenere la mobilità delle dita e del polso", "Favorire il drenaggio linfatico"] },
      { id: "fase1-interventi", titolo: "Interventi e tecniche", punti: ["Tutore notturno: mantiene il polso in posizione neutra, riducendo la compressione", "Terapie fisiche antinfiammatorie: laser, tecar, ultrasuoni, ionoforesi con FANS (se indicato)", "Mobilizzazione attiva dolce di dita e polso più volte al giorno", "Esercizi di scorrimento tendineo (QR 1): dita estese → “gancio” → pugno completo → ritorno; 10 ripetizioni, 3–4 serie al giorno", "Educazione ergonomica: evitare flessioni o estensioni prolungate del polso, pause frequenti al computer o durante attività manuali"] }
    ],
    i3: [
      { id: "fase2", titolo: "Settimana 3–5", testo: "Obiettivi:", punti: ["Ripristinare la mobilità completa del polso", "Migliorare lo scorrimento del nervo mediano nel tunnel", "Ridurre le aderenze miofasciali e tendinee"] },
      { id: "fase2-esercizi", titolo: "Esercizi mirati", punti: ["Esercizi neurodinamici del nervo mediano (QR 2)", "Stretching di pronatori, flessori superficiali e profondi delle dita (QR 3)", "Mobilizzazioni articolari assistite del polso e delle articolazioni intercarpali", "Automassaggio palmare e volare con crema neutra o pallina morbida (QR 4)", "Continuazione dell’uso del tutore notturno, se persistono sintomi notturni"] },
      { id: "fase3", titolo: "Settimane 5–6: rinforzo e funzionalità", testo: "Obiettivi: migliorare forza e resistenza della mano, consolidare la mobilità articolare, prevenire la recidiva dei sintomi.", punti: ["Rinforzo progressivo con palline di resistenza morbida, spugne o elastici leggeri", "Coordinazione fine: raccolta di piccoli oggetti, mollette, pinze o elastici tra le dita", "Propriocezione con oggetti di diversa forma e consistenza", "Stretching finale del nervo mediano e dei flessori", "Educazione ergonomica avanzata: posture lavorative e micro-pause"] }
    ],
    e1: [
      { id: "postop", titolo: "Trattamento post-operatorio", punti: ["Controllo del dolore e dell’edema: ghiaccio localmente (non direttamente sulla ferita) e mano sollevata", "Protezione della ferita: medicazione pulita e asciutta; non forzare i movimenti fino alla rimozione dei punti", "Mobilizzazione precoce delle dita: subito movimenti dolci di flessione ed estensione", "Tutore in posizione neutra: leggero, soprattutto di notte", "Cura della cicatrice: dopo la guarigione cutanea, massaggi circolari e trasversali con crema neutra", "Scorrimento tendineo e nervoso: gliding quotidiano di flessori, estensori e nervo mediano", "Mobilità del polso: aumentare gradualmente l’escursione, senza dolore", "Rinforzo progressivo dalla 3ª–4ª settimana: pallina morbida, elastici leggeri, pinze e piccoli oggetti"] },
      { id: "sensitiva", titolo: "Desensibilizzazione e rieducazione sensitiva", testo: "Stimolare la zona palmare con tessuti di diversa consistenza per normalizzare la sensibilità." },
      { id: "ritorno", titolo: "Ritorno funzionale e prevenzione delle recidive", testo: "Ripresa graduale delle attività quotidiane e lavorative, evitando posture mantenute o movimenti ripetitivi del polso." }
    ],
    e2: [
      { id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" },
      { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate" },
      { id: "contatti", tipo: "contatti", titolo: "Contattaci" }
    ]
  },
  esercizi: [
    { id: "ex-gliding", fase: "Settimana 1–3", nome: "QR 1 – Scorrimento tendineo (tendon gliding)", obiettivo: "Far scorrere i tendini flessori e ridurre la pressione nel tunnel.", posizione: "Seduto, gomito appoggiato, mano verso l’alto.", passi: ["Dita estese", "Flessione a “gancio”", "Pugno completo", "Ritorno all’estensione"], dosaggio: "10 ripetizioni, 3–4 serie al giorno", attenzione: "", foto: "", video: "" },
    { id: "ex-neurodinamica", fase: "Settimana 3–5", nome: "QR 2 – Esercizi neurodinamici del nervo mediano", obiettivo: "Favorire lo scorrimento del nervo mediano.", posizione: "In piedi o seduto, spalla abdotta a 90°, gomito esteso, polso e dita estese.", passi: ["Movimento alternato di flessione ed estensione del polso", "Eseguire lentamente"], dosaggio: "3 serie da 10", attenzione: "Senza evocare dolore o formicolio persistente.", foto: "", video: "" },
    { id: "ex-stretching", fase: "Settimana 3–5", nome: "QR 3 – Stretching di pronatori e flessori delle dita", obiettivo: "Ridurre le tensioni muscolari dell’avambraccio.", posizione: "", passi: ["Allungamento dei pronatori", "Allungamento dei flessori superficiali e profondi delle dita"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-automassaggio", fase: "Settimana 3–5", nome: "QR 4 – Automassaggio palmare e volare", obiettivo: "Migliorare la vascolarizzazione e ridurre le aderenze.", posizione: "Crema neutra o pallina morbida.", passi: ["Massaggio del palmo", "Massaggio della faccia volare dell’avambraccio"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-rinforzo", fase: "Settimane 5–6", nome: "Rinforzo progressivo", obiettivo: "Forza e resistenza della mano.", posizione: "", passi: ["Palline di resistenza morbida", "Spugne", "Elastici leggeri"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-coordinazione", fase: "Settimane 5–6", nome: "Coordinazione fine e propriocezione", obiettivo: "Destrezza.", posizione: "Seduto al tavolo.", passi: ["Raccolta di piccoli oggetti", "Uso di mollette, pinze o elastici tra le dita", "Manipolazione di oggetti di diversa forma e consistenza"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-sensitiva", fase: "Post-operatorio", nome: "Desensibilizzazione", obiettivo: "Normalizzare la sensibilità della zona palmare.", posizione: "", passi: ["Stimolare la zona con tessuti di diversa consistenza (dal più morbido al più ruvido)"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" }
  ],
  bibliografia: [],
  storico: [ { data: "2026-11-16", testo: "Importata dalla brochure originale (brochure TUNNEL CARPALE). Logo ASL 2 sostituito con ATS Liguria.", fonte: "" } ]
},

/* =============================== TENDINI ESTENSORI =============================== */
{
  id: "tendini-estensori",
  titolo: "Riabilitazione dopo lesione dei tendini estensori",
  categoria: "Tendini",
  aggiornato: "2026-11-16",
  versione: 1,
  immagine: "",
  pannelli: {
    cover: [
      { id: "cose", titolo: "Cosa sono i tendini estensori", testo: "I tendini estensori permettono di stendere le dita e bilanciare la flessione durante la presa.\nSono più superficiali e sottili rispetto ai flessori, quindi più vulnerabili a ferite da taglio.", immagine: true },
      { id: "sistema", testo: "Ogni dito possiede un sistema estensorio complesso (zone 1–8) formato da:", punti: ["tendine estensore comune (EDC)", "bande laterali", "banda centrale", "espansione dorsale", "meccanismo terminale"] }
    ],
    i1: [
      { id: "trattamento", titolo: "Trattamento", testo: "Dipende dalla zona della lesione:", punti: ["Zone 1–2 (mallet finger) → spesso ortesi senza chirurgia per 6–8 settimane", "Zone 3–4 (boutonnière) → ortesi continua in estensione, correzione delle bande laterali", "Zone 5–8 (mano–polso) → spesso intervento chirurgico per suturare il tendine, seguito da tutore e riabilitazione"] },
      { id: "perche", titolo: "Perché serve la riabilitazione", testo: "Il tendine estensore è sottile e tende a formare aderenze che limitano l’estensione. Il trattamento riabilitativo:", punti: ["protegge la sutura o l’avulsione", "evita deformità (boutonnière, swan neck)", "recupera scorrimento e forza"] },
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "Mallet: IFD in estensione · Boutonnière: IFP in estensione con IFD libera · Lesioni prossimali: tutore polso + dita", quando: "Uso costante, senza interruzioni (settimane 0–3)", quanto: "Giorno e notte, salvo diversa indicazione", durata: "6–8 settimane secondo tipo di lesione", note: "Anche pochi minuti senza ortesi possono compromettere il risultato (specialmente zone 1–3)." } }
    ],
    i2: [
      { id: "fase1", titolo: "Settimane 0–3", testo: "Obiettivi: protezione, mantenere estensione, ridurre edema.", punti: ["Uso costante dell’ortesi (senza interruzioni)", "Mobilità attiva delle altre articolazioni (polso, dita non coinvolte)", "Controllo edema con elevazione e movimento leggero"] },
      { id: "fase2", titolo: "Settimane 3–5", testo: "Obiettivi: iniziare movimento controllato, evitare aderenze.", punti: ["Mobilizzazione attiva graduata dell’articolazione protetta", "Attivo-assistito nelle zone operate secondo protocollo", "Inizio massaggio cicatriziale (se guarita)"] },
      { id: "fase3", titolo: "Settimane 5–8", testo: "Obiettivi: recuperare estensione e flessione funzionale.", punti: ["Estensione attiva completa", "Flessione attiva controllata", "Presa leggera e attività quotidiane semplici", "Coordinazione fine (prendere monete, digitazione lenta)"] }
    ],
    i3: [
      { id: "fase4", titolo: "Settimane 8–12", testo: "Obiettivi: forza e funzionalità completa.", punti: ["Rinforzo con elastici leggeri", "Presa e rilascio ripetuti", "Esercizi specifici per lavoro/sport"], nota: "Carichi pesanti: dopo 10–12 settimane se autorizzati." },
      { id: "cosa-fare", titolo: "Cosa puoi fare", punti: ["Tenere l’ortesi asciutta e ben aderente", "Muovere dita e polso non coinvolti", "Tenere la mano sollevata per ridurre il gonfiore", "Seguire gli esercizi indicati dal terapista"] },
      { id: "non-fare", titolo: "Cosa NON fare", punti: ["Non togliere l’ortesi da soli", "Non flettere forzatamente il dito trattato", "Non sorreggere pesi o borse nelle prime settimane", "Non fare lavori domestici energici", "Non spingere con il dito su superfici dure"] }
    ],
    e1: [
      { id: "allarme", titolo: "Segnali di allarme", punti: ["Perdita improvvisa di estensione", "Deformità nuove (dito che “cede”)", "Dolore o gonfiore marcati", "Aumento calore/rossore o febbre → contattare terapista/chirurgo"] },
      { id: "obiettivi-finali", titolo: "Obiettivi finali", punti: ["Estensione completa senza compensi", "Buona flessione funzionale", "Forza adeguata per le attività quotidiane", "Cicatrice morbida e mobile", "Recupero della destrezza fine"] },
      { id: "educazione", titolo: "Educazione al paziente", punti: ["La guarigione degli estensori è lenta: non forzare la flessione", "L’ortesi è fondamentale: anche pochi minuti senza possono compromettere il risultato (specialmente zone 1–3)", "Gli esercizi vanno fatti spesso e con delicatezza", "Evitare colpi, urti o prese forti fino alla completa stabilità"] }
    ],
    e2: [
      { id: "qr", tipo: "qr", titolo: "6 video QR" },
      { id: "contatti", tipo: "contatti", titolo: "Contatti" }
    ]
  },
  esercizi: [
    { id: "ex-tutore", fase: "Settimane 0–3", nome: "1 – Come usare e proteggere il tutore", obiettivo: "Proteggere la riparazione del tendine.", posizione: "", passi: ["Controllare che il tutore sia asciutto e ben aderente", "Per l’igiene, mantenere il dito in estensione appoggiato su un piano (come mostrato dal terapista)", "Non togliere il tutore da soli"], dosaggio: "", attenzione: "Anche pochi minuti senza tutore possono compromettere il risultato.", foto: "", video: "" },
    { id: "ex-place-hold", fase: "Settimane 0–3", nome: "2 – Esercizi passivi e Place & Hold (prime settimane)", obiettivo: "Mantenere lo scorrimento del tendine in sicurezza.", posizione: "Secondo protocollo del terapista.", passi: ["Il terapista porta il dito nella posizione indicata", "Mantenere attivamente la posizione per alcuni secondi", "Rilassare"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se insegnato dal terapista, secondo protocollo.", foto: "", video: "" },
    { id: "ex-attiva", fase: "Settimane 3–5", nome: "3 – Mobilità attiva progressiva", obiettivo: "Iniziare il movimento controllato ed evitare aderenze.", posizione: "", passi: ["Mobilizzazione attiva graduata dell’articolazione protetta", "Attivo-assistito secondo protocollo"], dosaggio: "Secondo indicazione del terapista", attenzione: "Non forzare la flessione.", foto: "", video: "" },
    { id: "ex-cicatrice", fase: "Settimane 3–5", nome: "4 – Gestione cicatrice e edema", obiettivo: "Cicatrice morbida, meno gonfiore.", posizione: "", passi: ["Massaggio cicatriziale (se la ferita è guarita)", "Mano sollevata e movimento leggero"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-presa", fase: "Settimane 5–8", nome: "5 – Presa funzionale e oggetti leggeri", obiettivo: "Recuperare estensione e flessione funzionale.", posizione: "", passi: ["Presa leggera di oggetti", "Prendere monete", "Digitazione lenta"], dosaggio: "Secondo indicazione del terapista", attenzione: "", foto: "", video: "" },
    { id: "ex-rinforzo", fase: "Settimane 8–12", nome: "6 – Rinforzo, destrezza e ritorno alle attività", obiettivo: "Forza e funzionalità completa.", posizione: "", passi: ["Rinforzo con elastici leggeri", "Presa e rilascio ripetuti", "Esercizi specifici per lavoro/sport"], dosaggio: "Secondo indicazione del terapista", attenzione: "Carichi pesanti solo dopo 10–12 settimane, se autorizzati.", foto: "", video: "" }
  ],
  bibliografia: [],
  storico: [ { data: "2026-11-16", testo: "Importata dalla brochure originale (BROCHURE ESTENSORI DEF.). Logo ASL 2 sostituito con ATS Liguria.", fonte: "" } ]
},

/* =============================== EDEMA, CICATRICE E DOLORE =============================== */
{
  id: "edema-cicatrice-dolore",
  titolo: "Riabilitazione post-operatoria: edema, cicatrice e dolore",
  categoria: "Post-operatorio generale",
  aggiornato: "2026-11-16",
  versione: 1,
  immagine: "",
  pannelli: {
    cover: [
      { id: "cosa-succede", titolo: "Cosa succede dopo l’intervento?", testo: "È normale avere gonfiore, indurimento della cicatrice e dolore. Un corretto percorso riabilitativo permette di recuperare movimento, forza e funzionalità in modo sicuro e progressivo.", immagine: true }
    ],
    i1: [
      { id: "edema", titolo: "Gestione dell’edema post-operatorio", testo: "Dopo un intervento alla mano o al polso, è normale che compaia gonfiore. Un’adeguata gestione dell’edema favorisce la guarigione, riduce il dolore e migliora il movimento." },
      { id: "edema-fare", titolo: "Cosa fare", punti: ["Tenere la mano sollevata sopra il livello del cuore più volte al giorno", "Aprire e chiudere delicatamente le dita ogni ora", "Applicare ghiaccio protetto (15 minuti) se indicato dal chirurgo", "Utilizzare eventuale bendaggio elastico o guanto compressivo se prescritto"] },
      { id: "edema-evitare", titolo: "Cosa evitare", punti: ["Tenere la mano verso il basso per lunghi periodi", "Stringere forte oggetti o sollevare pesi", "Movimenti bruschi o ripetitivi"] }
    ],
    i2: [
      { id: "obiettivi", titolo: "Obiettivi della riabilitazione", punti: ["Prevenire rigidità", "Recuperare funzione", "Ridurre dolore e gonfiore", "Favorire guarigione dei tessuti"] },
      { id: "trattamento", titolo: "Trattamento riabilitativo", testo: "La riabilitazione personalizzata permette un recupero più rapido e sicuro. Comprende:", punti: ["Esercizi per migliorare movimento e forza", "Tecniche per la cicatrice", "Educazione all’uso corretto della mano", "Riduzione del dolore con tecniche non invasive", "Trattamento dell’edema"] },
      { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "Secondo l’intervento eseguito", quando: "Solo nei tempi prescritti", quanto: "Secondo indicazione del terapista", durata: "Secondo indicazione del terapista", note: "" } },
      { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate" }
    ],
    i3: [
      { id: "dolore", titolo: "Gestione del dolore", testo: "Il dolore è una risposta naturale dopo chirurgia. Capire come gestirlo aiuta a ridurlo e a muovere meglio." },
      { id: "dolore-strategie", titolo: "Strategie utili", punti: ["Movimento dolce e frequente delle dita", "Tenere la mano sollevata", "Applicare ghiaccio se consigliato", "Rispettare le indicazioni sui farmaci antinfiammatori", "Usare il tutore solo nei tempi prescritti"] },
      { id: "dolore-medico", titolo: "Quando consultare il medico", punti: ["Dolore che aumenta invece di diminuire", "Arrossamento o calore eccessivo", "Febbre o secrezioni dalla ferita"] },
      { id: "movimento", titolo: "Ritorno al movimento e attività", testo: "Mantenere il movimento delle dita e del polso è fondamentale per evitare rigidità.", punti: ["Da subito (se consentito): aprire e chiudere delicatamente le dita; flettere ed estendere polso e gomito senza dolore", "Dalle prime settimane: movimenti più ampi delle dita, esercizi di coordinazione", "Evitare forza eccessiva fino al via libera medico"] }
    ],
    e1: [
      { id: "cicatrice", titolo: "Gestione della cicatrice", testo: "La cicatrice deve essere trattata correttamente per evitare aderenze, indurimenti e limitazioni di movimento." },
      { id: "cicatrice-cosa", titolo: "Dal 10°–14° giorno (se la ferita è chiusa)", punti: ["Massaggio circolare con crema idratante", "Movimenti delicati di sollevamento della pelle per ridurre adesioni", "Mobilizzazione della cicatrice durante il movimento delle dita", "Applicazione di gel o cerotti in silicone (se prescritti)"] },
      { id: "cicatrice-obiettivi", titolo: "Obiettivi", punti: ["Ridurre rigidità del tessuto", "Migliorare elasticità e scorrimento", "Prevenire aderenze profonde", "Favorire un aspetto estetico migliore"] },
      { id: "cicatrice-avvertenze", titolo: "Avvertenze", punti: ["Non massaggiare se la ferita non è completamente chiusa", "Evitare eccessiva pressione inizialmente"] }
    ],
    e2: [
      { id: "qr", tipo: "qr", titolo: "QR code – esercizi" },
      { id: "contatti", tipo: "contatti", titolo: "Contatti" }
    ]
  },
  esercizi: [
    { id: "ex-elevazione", fase: "Da subito", nome: "Elevazione e pompa delle dita", obiettivo: "Ridurre il gonfiore.", posizione: "Mano sollevata sopra il livello del cuore (es. su cuscini).", passi: ["Aprire completamente le dita", "Chiudere delicatamente a pugno"], dosaggio: "Ogni ora", attenzione: "Senza dolore.", foto: "", video: "" },
    { id: "ex-polso-gomito", fase: "Da subito", nome: "Flesso-estensione di polso e gomito", obiettivo: "Evitare rigidità delle articolazioni libere.", posizione: "", passi: ["Flettere ed estendere il polso (se consentito)", "Flettere ed estendere il gomito"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se consentito, senza dolore.", foto: "", video: "" },
    { id: "ex-massaggio-cicatrice", fase: "Dal 10°–14° giorno", nome: "Massaggio della cicatrice", obiettivo: "Ammorbidire la cicatrice e prevenire aderenze.", posizione: "Crema idratante.", passi: ["Massaggio circolare", "Sollevamento delicato della pelle", "Mobilizzare la cicatrice mentre si muovono le dita"], dosaggio: "Secondo indicazione del terapista", attenzione: "Solo se la ferita è completamente chiusa.", foto: "", video: "" },
    { id: "ex-coordinazione", fase: "Dalle prime settimane", nome: "Esercizi di coordinazione", obiettivo: "Recuperare la funzione.", posizione: "", passi: ["Movimenti più ampi delle dita", "Prendere e spostare piccoli oggetti"], dosaggio: "Secondo indicazione del terapista", attenzione: "Evitare forza eccessiva fino al via libera medico.", foto: "", video: "" }
  ],
  bibliografia: [],
  storico: [ { data: "2026-11-16", testo: "Importata dalla brochure originale (BROCHURE EDEMA CICATRICE DOLORE POST-OP DEFINITIVO). Logo ASL 2 sostituito con ATS Liguria.", fonte: "" } ]
}
];

/* Modello vuoto per creare una nuova patologia */
window.TEMPLATE_DOC = {
  titolo: "Riabilitazione – Nuova patologia",
  categoria: "",
  immagine: "",
  pannelli: {
    cover: [ { id: "cose", titolo: "Cos’è?", testo: "Descrizione breve della patologia.", immagine: true } ],
    i1: [ { id: "sintomi", titolo: "Sintomi", punti: ["…"] }, { id: "chirurgia", titolo: "Trattamento chirurgico – quando?", punti: ["…"] } ],
    i2: [ { id: "conservativo", titolo: "Trattamento conservativo – quando?", punti: ["…"] }, { id: "ortesi", tipo: "ortesi", titolo: "Ortesi (tutore)", campi: { tipo: "", quando: "", quanto: "", durata: "", note: "" } } ],
    i3: [ { id: "fase1", titolo: "Settimane 1–3", punti: ["…"] }, { id: "fase2", titolo: "Settimane 3–6", punti: ["…"] } ],
    e1: [ { id: "cosa-fare", titolo: "Cosa fare", punti: ["…"] }, { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate" } ],
    e2: [ { id: "qr", tipo: "qr", titolo: "Esercizi – QR code video" }, { id: "contatti", tipo: "contatti", titolo: "Contattaci" } ]
  },
  esercizi: [],
  bibliografia: [],
  storico: []
};

window.DEFAULT_SETTINGS = {
  ente: "ATS Liguria",
  centro: "Centro Regionale di Chirurgia della Mano",
  progetto: "Progetto “RE-HAND more MIND”",
  logoEnte: "assets/logo/ats-liguria.png",
  logoProgetto: "assets/logo/rehand-more-mind.png",
  contatti: [
    { nome: "ATS Liguria – Centro Regionale Chirurgia della Mano", tel: "019 8404865", orari: "dal lunedì al venerdì" },
    { nome: "Ambulatorio di Ortesi e Riabilitazione della Mano", tel: "019 8404363", orari: "dalle 12:30 alle 14:00, dal lunedì al venerdì" }
  ],
  feedUrl: "aggiornamenti.json",
  colore: "#1d4f9c",
  colore2: "#3aa635"
};
