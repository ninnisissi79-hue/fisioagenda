/* Frattura del radio distale: brochure e opuscolo arricchiti con le linee guida delle società della mano
   (AAOS/ASSH 2020, BSSH/BOAST, ESTES 2026, JOSPT 2024) e con la letteratura recente. */
(function () {
  const C = (u) => "https://consensus.app/papers/details/" + u + "/?utm_source=claude_desktop";
  const E = (id, fase, nome, o) => Object.assign({ id, fase, nome, obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }, o);
  const F1 = "Fase 1 – Protezione", F2 = "Fase 2 – Movimento", F3 = "Fase 3 – Forza";

  const PANNELLI = {
    cover: [
      { id: "cose", titolo: "La frattura del radio distale", testo: "È la frattura più frequente dell’arto superiore: il radio si rompe vicino al polso, di solito cadendo sulla mano aperta. Può essere trattata con il gesso oppure con un intervento (di solito una placca con viti).", immagine: true },
      { id: "tipi", titolo: "Non sono tutte uguali", punti: ["Composta: i frammenti sono rimasti al loro posto", "Scomposta: i frammenti si sono spostati e vanno riallineati", "Articolare: la frattura entra nell’articolazione del polso"], nota: "Il tipo di frattura, l’età e le attività della persona guidano la scelta tra gesso e intervento." },
      { id: "obiettivi", titolo: "Obiettivi della riabilitazione", punti: ["Ridurre gonfiore e dolore", "Evitare la rigidità di dita, gomito e spalla", "Recuperare movimento, forza e uso della mano nella vita di tutti i giorni"] },
    ],
    e1: [
      { id: "subito", titolo: "Da subito", punti: ["Muovi le dita, il gomito e la spalla più volte al giorno", "Tieni la mano sollevata sopra il cuore", "Usa la mano per attività leggere, se consentito"] },
      { id: "gesso-cura", titolo: "Se hai il gesso", protocolli: ["gesso"], punti: ["Tienilo asciutto: per lavarti coprilo con un sacchetto", "Non infilare oggetti sotto il gesso per grattarti", "Le nocche devono restare libere di piegarsi", "Controlla che le dita siano rosee e calde"] },
      { id: "placca-cura", titolo: "Dopo l’intervento", protocolli: ["placca"], punti: ["Medicazione pulita e asciutta fino alla rimozione dei punti (circa 2 settimane)", "Il tutore si può togliere per gli esercizi, se il chirurgo lo consente", "Un po’ di gonfiore e di fastidio sulla cicatrice sono normali"] },
      { id: "allarme", titolo: "Contatta subito il centro se", punti: ["Dita fredde, bianche, violacee o molto gonfie", "Formicolio o addormentamento delle dita che aumenta", "Gesso troppo stretto o che fa male", "Dolore molto forte e sproporzionato, con pelle lucida o cambi di colore e temperatura"] },
    ],
    i1: [
      { id: "gesso-info", titolo: "Il trattamento in gesso", protocolli: ["gesso"], testo: "Il gesso tiene ferma la frattura finché si consolida, di solito 4–6 settimane, con controlli radiografici. Nelle persone oltre i 60–65 anni, per molte fratture il gesso dà a un anno risultati simili all’intervento." },
      { id: "placca-info", titolo: "La placca", protocolli: ["placca"], testo: "La placca rende la frattura stabile e permette di muovere presto il polso: in uno studio controllato il movimento immediato ha dato, a un anno, più movimento e più forza rispetto a 5 settimane di gesso, senza più complicanze." },
      { id: "linee-guida", titolo: "Cosa dicono le linee guida della mano", punti: ["Le società di chirurgia della mano americane (ASSH) e britanniche (BSSH) indicano di scegliere il trattamento in base a frattura, età e richieste della persona", "La linea guida di riabilitazione (JOSPT 2024) raccomanda esercizi guidati e un programma a casa ben spiegato", "La fisioterapia seguita dal terapista dà benefici soprattutto nelle prime settimane, in particolare oltre i 65 anni"] },
      { id: "casa", titolo: "Esercizi a casa", testo: "Un programma strutturato di esercizi a casa, ben spiegato e controllato dal terapista, è la base del recupero: la tua costanza conta più di tutto." },
    ],
    i2: [
      { id: "ortesi-g", tipo: "ortesi", titolo: "Gesso / ortesi", protocolli: ["gesso"], campi: { tipo: "Gesso antibrachio-metacarpale (dita libere), poi eventuale tutore", quando: "Fino alla consolidazione", quanto: "Sempre", durata: "Circa 4–6 settimane secondo il medico", note: "Le nocche (MF) devono restare libere di piegarsi." } },
      { id: "ortesi-p", tipo: "ortesi", titolo: "Ortesi (tutore)", protocolli: ["placca"], campi: { tipo: "Tutore di polso rimovibile", quando: "Per il comfort, fuori dagli esercizi", quanto: "Di giorno nelle attività e la notte nelle prime settimane", durata: "Circa 1–2 settimane, poi solo se serve", note: "Toglierlo per gli esercizi se il chirurgo lo consente." } },
      { id: "fase1", titolo: "Fase 1 – Protezione", testo: "Gesso: settimane 0–6. Placca: settimane 0–2.", punti: ["Dita: apri e chiudi, scorrimento tendineo, pugno a tavola", "Pollice: tocca ogni dito", "Gomito e spalla: movimenti completi più volte al giorno", "Placca: polso su e giù e rotazioni dolci dai primi giorni, se consentito"] },
    ],
    i3: [
      { id: "fase2", titolo: "Fase 2 – Movimento", testo: "Dopo il gesso, oppure dalla 2ª settimana con la placca.", punti: ["Polso su e giù, inclinazioni, rotazione dell’avambraccio", "Gesti fini: monete, bottoni, scrivere", "Uso della mano nelle attività quotidiane leggere"] },
      { id: "fase3", titolo: "Fase 3 – Forza", testo: "Di solito dalla 6ª–8ª settimana, con il via libera del medico.", punti: ["Elastico e piccoli pesi (una bottiglietta d’acqua)", "Carico progressivo sul palmo", "Ritorno graduale al lavoro e allo sport"], nota: "Il recupero completo richiede spesso 3–6 mesi; la forza continua a migliorare fino a un anno." },
      { id: "ritorno", titolo: "Guida, lavoro e sport", punti: ["Guida: solo quando tieni e giri il volante in sicurezza, senza tutore e con il permesso del medico", "Lavoro d’ufficio: spesso dopo poche settimane; lavori pesanti dopo la fase di forza", "Sport con carico sulle mani: dopo 3 mesi circa, se autorizzato"] },
      { id: "ossa", titolo: "Le tue ossa", testo: "Dopo i 50 anni una frattura di polso per una caduta banale può essere il segnale di ossa fragili: parlane con il medico di famiglia per un controllo dell’osteoporosi e per prevenire nuove cadute." },
    ],
  };

  const ESERCIZI = [
    E("rd-elev", F1, "Mano sollevata", { obiettivo: "Ridurre gonfiore e dolore.", posizione: "Seduto o sdraiato, mano su un cuscino più in alto del cuore.", passi: ["Tieni la mano sollevata più volte al giorno", "Muovi le dita mentre è sollevata"], dosaggio: "Più volte al giorno, soprattutto nei primi giorni", attenzione: "Evita di tenere il braccio a penzoloni.", disegno: "elevazione" }),
    E("rd-dita", F1, "Apri e chiudi la mano", { obiettivo: "Evitare rigidità e gonfiore delle dita.", posizione: "Mano sollevata.", passi: ["Apri bene le dita", "Chiudi a pugno completo"], dosaggio: "10 ripetizioni ogni ora", attenzione: "", disegno: "pugno-apri" }),
    E("rd-gliding", F1, "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini delle dita.", posizione: "Gomito appoggiato, mano verso l’alto.", passi: ["Dita dritte", "Tavola", "Gancio", "Pugno dritto", "Pugno"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "", disegno: "gliding" }),
    E("rd-tavola", F1, "Piegare le nocche (posizione a tavola)", { obiettivo: "Mantenere mobili le nocche, che con il gesso tendono a irrigidirsi.", posizione: "Gomito appoggiato, mano verso l’alto.", passi: ["Parti con le dita dritte", "Piega solo le nocche tenendo le dita dritte"], dosaggio: "10 ripetizioni, 3–4 volte al giorno", attenzione: "Il gesso non deve impedire questo movimento: se lo blocca, segnalalo.", disegno: "flessione-mf" }),
    E("rd-pollice", F1, "Pollice tocca ogni dito", { obiettivo: "Mobilità del pollice.", posizione: "Seduto, avambraccio appoggiato.", passi: ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"], dosaggio: "5 giri, 4 volte al giorno", attenzione: "", disegno: "opposizione" }),
    E("rd-ventaglio", F1, "Apertura delle dita a ventaglio", { obiettivo: "Mobilità laterale delle dita.", posizione: "Mano appoggiata.", passi: ["Apri le dita a ventaglio", "Mantieni 5 secondi e rilassa"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "ventaglio" }),
    E("rd-polso", F2, "Polso su e giù", { obiettivo: "Recuperare il movimento del polso.", posizione: "Avambraccio appoggiato sul tavolo, mano oltre il bordo.", passi: ["Polso in giù", "Polso in su"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "Con placca: dai primi giorni solo se il chirurgo lo consente.", disegno: "polso-flex-ext" }),
    E("rd-rotazioni", F2, "Rotazione dell’avambraccio", { obiettivo: "Recuperare la rotazione palmo su / palmo giù.", posizione: "Gomito a 90° vicino al fianco.", passi: ["Palmo verso l’alto", "Palmo verso il basso"], dosaggio: "10 ripetizioni, 4 volte al giorno", attenzione: "Il gomito resta attaccato al fianco.", disegno: "pronosupinazione" }),
    E("rd-deviazioni", F2, "Inclinazioni del polso", { obiettivo: "Movimento laterale del polso.", posizione: "Mano appoggiata sul tavolo.", passi: ["Scivola verso il pollice", "Scivola verso il mignolo"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "deviazioni" }),
    E("rd-pinch", F2, "Prendere piccoli oggetti", { obiettivo: "Recuperare la precisione nei gesti fini.", posizione: "Seduto al tavolo con monete o bottoni.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" }),
    E("rd-destrezza", F2, "Rotazione di una pallina nel palmo", { obiettivo: "Destrezza senza stringere.", posizione: "Seduto, palmo verso l’alto con una pallina piccola e leggera.", passi: ["Fai ruotare la pallina in un senso", "Poi nel senso opposto", "Mano rilassata: la pallina non va stretta"], dosaggio: "1 minuto per senso, 2 volte al giorno", attenzione: "Non stringere la pallina.", disegno: "rotazione-pallina" }),
    E("rd-elastico", F3, "Rinforzo con elastico leggero", { obiettivo: "Recuperare la forza delle dita senza stringere.", posizione: "Elastico leggero intorno alle dita.", passi: ["Apri lentamente le dita contro l’elastico", "Mantieni 3 secondi e torna piano"], dosaggio: "2 serie da 10, una volta al giorno", attenzione: "", disegno: "elastico" }),
    E("rd-peso", F3, "Polso con un piccolo peso", { obiettivo: "Rinforzare i muscoli del polso.", posizione: "Avambraccio appoggiato, mano oltre il bordo, bottiglietta d’acqua da 250–500 ml in mano.", passi: ["Abbassa lentamente il polso", "Rialzalo lentamente"], dosaggio: "2 serie da 10, una volta al giorno", attenzione: "Solo con il via libera del medico; aumenta il peso gradualmente.", disegno: "polso-flex-ext" }),
    E("rd-quotidiano", F3, "Attività quotidiane con oggetti leggeri", { obiettivo: "Tornare a usare la mano normalmente.", posizione: "In piedi.", passi: ["Prendi con delicatezza una bottiglietta, una tazza, un libro", "Spostali da un ripiano all’altro"], dosaggio: "Più volte al giorno nelle attività", attenzione: "Impugna senza stringere forte.", disegno: "presa-bottiglia" }),
    E("rd-carico", F3, "Carico sul palmo", { obiettivo: "Tornare ad appoggiarsi sulla mano.", posizione: "In piedi davanti al tavolo.", passi: ["Appoggia il palmo sul tavolo", "Sposta gradualmente il peso sulla mano"], dosaggio: "5 × 10 secondi", attenzione: "Solo con il via libera del medico.", disegno: "carico-tfcc" }),
  ];

  const BIB = [
    ["Kamal R.N. et al. (2022). AAOS/ASSH Clinical Practice Guideline Summary: Management of Distal Radius Fractures. Journal of the American Academy of Orthopaedic Surgeons", "w:92357ae5-e948-4cea-b7cd-ca638ed2d6ca"],
    ["Johnson N.A. et al. (2019). The current evidence-based management of distal radial fractures: UK perspectives (BSSH/BOAST). Journal of Hand Surgery (European Volume)", "w:e8994014-b706-4b81-a252-320d39a93efa"],
    ["Lameijer C.M. et al. (2026). ESTES recommendations regarding distal radius fractures. European Journal of Trauma and Emergency Surgery", "w:7231f3f2-7bb8-4821-8515-0c69c45c3c0b"],
    ["Mehta S.P. et al. (2024). Distal Radius Fracture Rehabilitation – Clinical Practice Guidelines. JOSPT", "w:b8aac0e8-28f9-4a4c-9a69-a0f4cc621fd7"],
    ["Gutiérrez-Espinoza H. et al. (2026). Supervised physical therapy versus home exercise programs after distal radius fracture: systematic review with meta-analysis. JOSPT", "w:bf879049-a4b0-4ab6-9639-b96396c827b9"],
    ["CROSSFIRE Study Group (2021). Surgical plating vs closed reduction for fractures in the distal radius in older patients: RCT. JAMA Surgery", "w:f4ed8b7b-0356-49a1-ad2c-248ea4a66422"],
    ["Ochen Y. et al. (2020). Operative vs nonoperative treatment of distal radius fractures in adults: meta-analysis. JAMA Network Open", "w:df7d0a6c-7243-43c9-bf4f-1aeadaa4aeeb"],
  ];

  const MIG = {
    id: "2026-11-radio-plus",
    nota: "Frattura del radio distale arricchita con le linee guida delle società della mano (ASSH/AAOS, BSSH/BOAST, ESTES, JOSPT): brochure più completa e 15 esercizi illustrati.",
    apply(doc) {
      if (doc.id !== "frattura-radio-distale") return false;
      // brochure: sostituisce i blocchi con la nuova versione (le indicazioni personalizzate e i contatti restano)
      Object.entries(PANNELLI).forEach(([k, blocks]) => { doc.pannelli[k] = JSON.parse(JSON.stringify(blocks)); });
      // esercizi: nuova serie, conservando foto e video eventualmente inseriti negli esercizi con lo stesso id
      const old = new Map((doc.esercizi || []).map((e) => [e.id, e]));
      doc.esercizi = ESERCIZI.map((e) => { const o = old.get(e.id); const n = JSON.parse(JSON.stringify(e)); if (o) { if (o.foto) n.foto = o.foto; if (o.video) n.video = o.video; } return n; });
      doc.bibliografia = doc.bibliografia || [];
      BIB.forEach(([t, u]) => { if (!doc.bibliografia.some((r) => (r.url || "").includes(u))) doc.bibliografia.push({ testo: t, url: C(u) }); });
      return true;
    },
  };
  window.REHAND_MIGRAZIONI = window.REHAND_MIGRAZIONI || [];
  window.REHAND_MIGRAZIONI.push(MIG);
  (window.SEED_DOCS || []).forEach((d) => { MIG.apply(d); d.migrazioni = (d.migrazioni || []).concat(MIG.id); });
})();
