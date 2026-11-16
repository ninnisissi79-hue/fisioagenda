/* Modifiche di contenuto decise dal centro, applicate a tutti gli opuscoli
   (anche a quelli già pubblicati: l'app le applica e le pubblica quando entra l'amministratrice).
   Ogni modifica viene annotata nello "Storico" dell'opuscolo. */
(function () {
  const ROT = {
    nome: "Rotazione di una pallina nel palmo",
    obiettivo: "Migliorare destrezza e coordinazione delle dita senza stringere.",
    posizione: "Seduto, avambraccio appoggiato, palmo verso l’alto con una pallina piccola e leggera nel palmo.",
    passi: ["Fai ruotare la pallina nel palmo muovendo le dita, in un senso", "Poi falla ruotare nel senso opposto", "Tieni la mano rilassata: la pallina non va mai stretta"],
    dosaggio: "1 minuto per senso, 2–3 volte al giorno",
    attenzione: "Non stringere la pallina.",
    disegno: "rotazione-pallina",
  };
  const isSqueeze = (e) => {
    const t = [e.nome, e.posizione, e.obiettivo].concat(e.passi || []).join(" ").toLowerCase();
    if (/rota|rotol|massagg/.test(t)) return false;
    return /pallin/.test(t);
  };
  // frasi delle brochure da riscrivere
  const FRASI = [
    [/Rinforzo lieve della presa \(pallina morbida\)/g, "Esercizi di destrezza: rotazione di una pallina nel palmo, senza stringere"],
    [/Rinforzo progressivo con palline di resistenza morbida, spugne o elastici leggeri/g, "Rinforzo progressivo con elastici leggeri"],
    [/pallina morbida, elastici leggeri, pinze e piccoli oggetti/g, "elastici leggeri, pinze e piccoli oggetti"],
    [/Rinforzo progressivo \(pallina morbida, poi più dura\)/g, "Rinforzo progressivo con elastici leggeri e oggetti di uso quotidiano"],
    [/rinforzo con elastico\/pallina/g, "rinforzo con elastico"],
    [/Pallina, elastico, piccoli pesi/g, "Elastico e piccoli pesi"],
  ];
  const fixText = (v) => { if (typeof v !== "string") return v; let r = v; FRASI.forEach(([a, b]) => (r = r.replace(a, b))); return r; };

  window.REHAND_MIGRAZIONI = [{
    id: "2026-11-no-pallina",
    nota: "Rimossi gli esercizi in cui si stringe una pallina (indicazione del centro): sostituiti con la rotazione della pallina nel palmo.",
    apply(doc) {
      let ch = false;
      Object.values(doc.pannelli || {}).forEach((arr) => (arr || []).forEach((b) => {
        ["testo", "nota"].forEach((k) => { const n = fixText(b[k]); if (n !== b[k]) { b[k] = n; ch = true; } });
        if (b.punti) b.punti = b.punti.map((x) => { const n = fixText(x); if (n !== x) ch = true; return n; });
      }));
      const out = []; let rotDone = false;
      (doc.esercizi || []).forEach((e) => {
        // esercizio con più strumenti: si toglie solo la pallina
        const resto = (e.passi || []).filter((p) => !/pallin/i.test(p));
        if ((e.passi || []).some((p) => /pallin/i.test(p)) && resto.length && resto.every((p) => /spugn|elastic|mollett|pinz/i.test(p)) && !/pallin/i.test(e.nome)) {
          e.passi = e.passi.filter((p) => !/pallin/i.test(p)); if (e.disegno === "pallina") e.disegno = "elastico"; ch = true; out.push(e); return;
        }
        if (isSqueeze(e)) {
          ch = true;
          if (rotDone) return; // una sola rotazione per opuscolo
          rotDone = true; out.push(Object.assign({}, e, ROT)); return;
        }
        if (e.disegno === "pallina") { e.disegno = "pugno-apri"; ch = true; }
        out.push(e);
      });
      doc.esercizi = out;
      return ch;
    },
  }];
  // seconda indicazione del centro: niente spugne da stringere
  window.REHAND_MIGRAZIONI.push({
    id: "2026-11-no-spugna",
    nota: "Rimossi gli esercizi in cui si stringe una spugna (indicazione del centro).",
    apply(doc) {
      let ch = false;
      (doc.esercizi || []).forEach((e, i) => {
        const t = [e.nome, e.posizione, e.obiettivo].concat(e.passi || []).join(" ");
        if (!/spugn/i.test(t)) return;
        const altri = (e.passi || []).filter((p) => !/spugn/i.test(p));
        if (altri.length && altri.every((p) => /elastic/i.test(p))) {
          // esercizio di rinforzo: resta solo l'elastico, spiegato meglio
          doc.esercizi[i] = Object.assign({}, e, { nome: "Rinforzo con elastico leggero", posizione: "Seduto, avambraccio appoggiato, elastico leggero intorno alle dita.",
            passi: ["Apri lentamente le dita contro la resistenza dell’elastico", "Mantieni 3 secondi", "Torna piano alla posizione di partenza"], disegno: "elastico" });
        } else {
          doc.esercizi[i] = Object.assign({}, e, { nome: "Apertura e chiusura dolce delle dita", obiettivo: "Mantenere il movimento delle dita senza sovraccaricare la mano.",
            posizione: "Avambraccio appoggiato, polso dritto, mano rilassata.", passi: ["Chiudi piano le dita, senza stringere", "Riapri completamente la mano"], disegno: "pugno-apri" });
        }
        ch = true;
      });
      return ch;
    },
  });
  // CRPS più completa: più esercizi con figure, carico graduale, esercizio fisico generale
  window.REHAND_MIGRAZIONI.push({
    id: "2026-11-crps-plus",
    nota: "CRPS arricchita: esercizi quotidiani con figure, carico graduale, esercizio fisico generale.",
    apply(doc) {
      if (doc.id !== "crps") return false;
      const E = (id, fase, nome, o) => Object.assign({ id, fase, nome, obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }, o);
      const nuovi = [
        E("cr-elev", "Ogni giorno – Gonfiore e movimento", "Mano sollevata e “pompa” delle dita", { obiettivo: "Ridurre gonfiore e rigidità.", posizione: "Seduto o sdraiato, mano più in alto del cuore, appoggiata su un cuscino.", passi: ["Apri lentamente tutte le dita", "Chiudile piano senza stringere"], dosaggio: "10 volte ogni ora da sveglio", attenzione: "Togli anelli e braccialetti finché la mano è gonfia.", disegno: "pugno-apri" }),
        E("cr-opp", "Ogni giorno – Gonfiore e movimento", "Pollice tocca ogni dito", { obiettivo: "Mantenere mobilità e coordinazione delle dita.", posizione: "Seduto, avambraccio appoggiato.", passi: ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"], dosaggio: "5 giri, 3–4 volte al giorno", attenzione: "Movimento lento, senza forzare.", disegno: "opposizione" }),
        E("cr-ventaglio", "Ogni giorno – Gonfiore e movimento", "Apertura delle dita a ventaglio", { obiettivo: "Allungare dolcemente la mano.", posizione: "Mano appoggiata sul tavolo.", passi: ["Apri le dita a ventaglio il più possibile", "Mantieni 5 secondi e rilassa"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "ventaglio" }),
        E("cr-polso", "Ogni giorno – Gonfiore e movimento", "Polso su e giù in scarico", { obiettivo: "Mantenere il movimento del polso.", posizione: "Avambraccio appoggiato sul tavolo, mano oltre il bordo.", passi: ["Abbassa piano il polso", "Alzalo piano"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "Piccoli movimenti se il dolore è forte.", disegno: "polso-flex-ext-micro" }),
        E("cr-rot", "Ogni giorno – Gonfiore e movimento", "Ruotare l’avambraccio", { obiettivo: "Mantenere la rotazione palmo su / palmo giù.", posizione: "Seduto, gomito piegato a 90° vicino al fianco.", passi: ["Gira il palmo verso l’alto", "Gira il palmo verso il basso"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "pronosupinazione" }),
        E("cr-scrub", "Carico graduale (quando il dolore lo permette)", "Strofinare il tavolo con un panno", { obiettivo: "Abituare gradualmente la mano a sopportare un carico.", posizione: "In piedi davanti al tavolo, mano sul panno.", passi: ["Spingi il panno avanti e indietro appoggiando il peso sulla mano", "Aumenta poco alla volta durata e pressione"], dosaggio: "Da 1 a 5 minuti, 2–3 volte al giorno", attenzione: "Un fastidio lieve è accettabile; fermati se il dolore aumenta e non passa.", disegno: "mano-tavolo" }),
        E("cr-carry", "Carico graduale (quando il dolore lo permette)", "Portare un oggetto leggero", { obiettivo: "Tornare a usare la mano nelle attività quotidiane.", posizione: "In piedi.", passi: ["Prendi una bottiglietta leggera con delicatezza", "Portala per qualche passo", "Aumenta il peso molto gradualmente nelle settimane"], dosaggio: "Qualche minuto, 2–3 volte al giorno", attenzione: "Impugna senza stringere forte.", disegno: "presa-bottiglia" }),
        E("cr-carico", "Carico graduale (quando il dolore lo permette)", "Appoggiarsi sul palmo", { obiettivo: "Ridare fiducia alla mano nel sostenere il peso.", posizione: "In piedi davanti al tavolo.", passi: ["Appoggia il palmo sul tavolo", "Sposta poco peso sulla mano, poi di più nei giorni"], dosaggio: "5 × 10 secondi", attenzione: "Procedi a piccoli passi.", disegno: "carico-tfcc" }),
        E("cr-destrezza", "Carico graduale (quando il dolore lo permette)", "Rotazione di una pallina nel palmo", { obiettivo: "Destrezza e coordinazione senza stringere.", posizione: "Seduto, palmo verso l’alto con una pallina piccola e leggera.", passi: ["Fai ruotare la pallina in un senso", "Poi nel senso opposto", "Mano rilassata: la pallina non va stretta"], dosaggio: "1 minuto per senso, 2 volte al giorno", attenzione: "Non stringere la pallina.", disegno: "rotazione-pallina" }),
        E("cr-pinch", "Carico graduale (quando il dolore lo permette)", "Prendere piccoli oggetti", { obiettivo: "Recuperare la precisione nei gesti fini.", posizione: "Seduto al tavolo con monete o bottoni.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" }),
      ];
      const old = doc.esercizi || [];
      const ids = new Set(old.map((e) => e.id));
      const gmi = old.filter((e) => /^cr-(lat|imm|spec)$/.test(e.id));
      const resto = old.filter((e) => !/^cr-(lat|imm|spec)$/.test(e.id));
      const quot = "Ogni giorno – Gonfiore e movimento";
      const restoOk = resto.filter((e) => e.id !== "cr-mov").map((e) => (e.id === "cr-gliding" ? Object.assign({}, e, { fase: quot }) : e.id === "cr-desens" ? Object.assign({}, e, { fase: "Desensibilizzazione" }) : e));
      const nn = nuovi.filter((e) => !ids.has(e.id));
      const q = nn.filter((e) => e.fase === quot), c = nn.filter((e) => e.fase !== quot);
      const gl = restoOk.filter((e) => e.id === "cr-gliding"), ds = restoOk.filter((e) => e.id === "cr-desens"), alt = restoOk.filter((e) => !["cr-gliding", "cr-desens"].includes(e.id));
      doc.esercizi = gmi.concat(q.slice(0, 1), gl, q.slice(1), ds, c, alt);
      // nuovi blocchi della brochure
      const add = (k, b) => { doc.pannelli[k] = doc.pannelli[k] || []; if (!doc.pannelli[k].some((x) => x.id === b.id)) doc.pannelli[k].push(b); };
      add("i3", { id: "carico", titolo: "Carico graduale", testo: "Quando il dolore lo permette, si abitua la mano a sopportare peso e attrito con esercizi brevi e regolari: strofinare un piano con un panno, portare oggetti leggeri, appoggiarsi sul palmo. Si aumenta poco alla volta.", nota: "Un aumento lieve e temporaneo del dolore non significa danno: conta la progressione costante." });
      add("i1", { id: "aerobico", titolo: "Muovere tutto il corpo", punti: ["Camminata o bicicletta 20–30 minuti, quasi tutti i giorni", "Usa la mano malata in tutte le attività leggere: vestirsi, mangiare, scrivere", "Dormire bene e gestire lo stress aiuta a ridurre il dolore"] });
      // fonte aggiuntiva
      doc.bibliografia = doc.bibliografia || [];
      if (!doc.bibliografia.some((r) => /72209bd7/.test(r.url || ""))) doc.bibliografia.push({ testo: "Shafiee E. et al. (2023). The Effectiveness of Rehabilitation Interventions on Pain and Disability for Complex Regional Pain Syndrome: a systematic review and meta-analysis. Clinical Journal of Pain", url: "https://consensus.app/papers/details/w:72209bd7-966b-4a8b-8c07-4b4824dfa59a/?utm_source=claude_desktop" });
      return true;
    },
  });
  // anche i contenuti originali dell'app partono già corretti
  (window.SEED_DOCS || []).forEach((d) => window.REHAND_MIGRAZIONI.forEach((m) => { m.apply(d); d.migrazioni = (d.migrazioni || []).concat(m.id); }));
})();
