/* Revisione complessiva (novembre 2026): più esercizi illustrati nelle patologie più povere,
   passi allineati alle figure, dosi chiare, bibliografia per le brochure originali.
   Applicata a tutti gli opuscoli (anche pubblicati) tramite il sistema delle migrazioni. */
(function () {
  const C = (u) => "https://consensus.app/papers/details/" + u + "/?utm_source=claude_desktop";
  const E = (id, fase, nome, o) => Object.assign({ id, fase, nome, obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }, o);
  const SDI = " (salvo diversa indicazione)";

  /* esercizi da aggiungere: [dopo l'esercizio id (o null = in fondo alla stessa fase), esercizio] */
  const NUOVI = {
    "edema-cicatrice-dolore": [
      ["ex-elevazione", E("rv-ed-gliding", "Da subito", "Scorrimento tendineo", { obiettivo: "Far scorrere i tendini ed evitare che si incollino.", posizione: "Seduto, gomito appoggiato, mano verso l’alto.", passi: ["Dita dritte", "Gancio", "Pugno"], dosaggio: "10 ripetizioni, 3–4 volte al giorno" + SDI, attenzione: "Solo se consentito dal chirurgo.", disegno: "gliding-3" })],
      ["ex-polso-gomito", E("rv-ed-rot", "Da subito", "Ruotare l’avambraccio", { obiettivo: "Evitare rigidità di gomito e avambraccio.", posizione: "Seduto, gomito piegato a 90° vicino al fianco.", passi: ["Gira il palmo verso l’alto", "Gira il palmo verso il basso"], dosaggio: "10 ripetizioni, 3 volte al giorno" + SDI, attenzione: "", disegno: "pronosupinazione" })],
      ["ex-massaggio-cicatrice", E("rv-ed-desens", "Dal 10°–14° giorno", "Desensibilizzare la cicatrice", { obiettivo: "Ridurre il fastidio al tocco intorno alla cicatrice.", posizione: "Seduto, tessuti diversi a disposizione.", passi: ["Strofina la zona con un tessuto morbido (cotone)", "Passa a tessuti più ruvidi quando il fastidio diminuisce"], dosaggio: "2–5 minuti, 3 volte al giorno", attenzione: "Solo a ferita chiusa.", disegno: "desensibilizzazione" })],
      [null, E("rv-ed-opp", "Dalle prime settimane", "Pollice tocca ogni dito", { obiettivo: "Recuperare coordinazione e movimento del pollice.", posizione: "Seduto, avambraccio appoggiato.", passi: ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"], dosaggio: "5 giri, 3 volte al giorno" + SDI, attenzione: "", disegno: "opposizione" })],
      [null, E("rv-ed-ventaglio", "Dalle prime settimane", "Apertura delle dita a ventaglio", { obiettivo: "Allungare dolcemente la mano e la cicatrice.", posizione: "Mano appoggiata sul tavolo.", passi: ["Apri le dita a ventaglio il più possibile", "Mantieni 5 secondi e rilassa"], dosaggio: "10 ripetizioni, 3 volte al giorno" + SDI, attenzione: "", disegno: "ventaglio" })],
      [null, E("rv-ed-destrezza", "Dalle prime settimane", "Rotazione di una pallina nel palmo", { obiettivo: "Destrezza senza stringere.", posizione: "Seduto, palmo verso l’alto con una pallina piccola e leggera.", passi: ["Fai ruotare la pallina in un senso", "Poi nel senso opposto", "Mano rilassata: la pallina non va stretta"], dosaggio: "1 minuto per senso, 2 volte al giorno", attenzione: "Non stringere la pallina.", disegno: "rotazione-pallina" })],
    ],
    "rigidita-ifp": [
      [null, E("rv-ifp-elev", "Settimane 1–3", "Mano sollevata e movimento", { obiettivo: "Ridurre il gonfiore del dito.", posizione: "Mano più in alto del cuore, appoggiata su un cuscino.", passi: ["Apri completamente le dita", "Chiudi piano a pugno"], dosaggio: "10 volte ogni ora da sveglio", attenzione: "", disegno: "pugno-apri" })],
      [null, E("rv-ifp-pinch", "Dopo 6 settimane", "Prendere piccoli oggetti", { obiettivo: "Usare il dito nei gesti fini.", posizione: "Seduto al tavolo con monete o bottoni.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" })],
      [null, E("rv-ifp-elastico", "Dopo 6 settimane", "Rinforzo con elastico leggero", { obiettivo: "Recuperare forza senza stringere.", posizione: "Elastico leggero intorno alle dita.", passi: ["Apri lentamente le dita contro l’elastico", "Mantieni 3 secondi e torna piano"], dosaggio: "2 serie da 10, una volta al giorno", attenzione: "", disegno: "elastico" })],
    ],
    "rizoartrosi": [
      ["rz-ventaglio", E("rv-rz-polso", "Mobilità", "Polso: piccoli movimenti in scarico", { protocolli: ["conservativo"], obiettivo: "Mantenere il polso mobile senza caricare il pollice.", posizione: "Avambraccio appoggiato, mano oltre il bordo del tavolo.", passi: ["Abbassa piano il polso", "Alzalo piano"], dosaggio: "10 ripetizioni, 2–3 volte al giorno" + SDI, attenzione: "", disegno: "polso-flex-ext-micro" })],
      [null, E("rv-rz-barattolo", "Protezione articolare", "Aprire un barattolo senza sforzare il pollice", { protocolli: ["conservativo"], obiettivo: "Imparare gesti quotidiani che proteggono la base del pollice.", posizione: "In piedi, barattolo appoggiato sul tavolo.", passi: ["Blocca il barattolo con la mano sana o un tappetino antiscivolo", "Gira il coperchio con il palmo aperto, non con la pinza", "Se è duro usa un apribarattoli"], dosaggio: "Ogni volta che serve", attenzione: "Evita la pinza stretta pollice–indice per torsioni.", disegno: "presa-bottiglia" })],
      [null, E("rv-rz-destrezza", "Protezione articolare", "Rotazione di una pallina nel palmo", { obiettivo: "Destrezza senza caricare la base del pollice.", posizione: "Seduto, palmo verso l’alto con una pallina piccola e leggera.", passi: ["Fai ruotare la pallina in un senso", "Poi nel senso opposto", "Mano rilassata: la pallina non va stretta"], dosaggio: "1 minuto per senso, 2 volte al giorno", attenzione: "Non stringere la pallina.", disegno: "rotazione-pallina" })],
      [null, E("rv-rz-dita", "Dopo il gesso", "Muovere le dita lunghe", { protocolli: ["trapeziectomia"], obiettivo: "Evitare rigidità delle dita durante e dopo il gesso.", posizione: "Mano sollevata.", passi: ["Apri completamente le dita", "Chiudi piano a pugno"], dosaggio: "10 volte ogni ora", attenzione: "", disegno: "pugno-apri" })],
    ],
    "rigidita-mf": [
      [null, E("rv-mf-elev", "Esercizi chiave", "Mano sollevata e movimento", { obiettivo: "Ridurre il gonfiore sul dorso della mano.", posizione: "Mano più in alto del cuore.", passi: ["Apri completamente le dita", "Chiudi piano a pugno"], dosaggio: "10 volte ogni ora da sveglio", attenzione: "", disegno: "pugno-apri" })],
      [null, E("rv-mf-ventaglio", "Esercizi chiave", "Apertura delle dita a ventaglio", { obiettivo: "Mobilità laterale delle nocche.", posizione: "Mano appoggiata sul tavolo.", passi: ["Apri le dita a ventaglio", "Mantieni 5 secondi e rilassa"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "ventaglio" })],
      [null, E("rv-mf-pinch", "Dopo 6 settimane", "Prendere piccoli oggetti", { obiettivo: "Usare la mano nei gesti fini.", posizione: "Seduto al tavolo con monete o bottoni.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" })],
    ],
    "dupuytren": [
      ["du-pugno", E("rv-du-elev", "Settimane 0–2", "Mano sollevata", { obiettivo: "Ridurre gonfiore e dolore dopo l’intervento.", posizione: "Seduto o sdraiato, mano su un cuscino più in alto del cuore.", passi: ["Tieni la mano sollevata più volte al giorno", "Muovi le dita mentre è sollevata"], dosaggio: "Più volte al giorno, soprattutto nei primi giorni", attenzione: "", disegno: "elevazione" })],
      ["du-est", E("rv-du-tavolo", "Settimane 2–6", "Stendere la mano sul tavolo", { obiettivo: "Mantenere l’estensione delle dita.", posizione: "Seduto, palmo appoggiato sul tavolo.", passi: ["Appoggia il palmo e stendi bene le dita", "Premi dolcemente le dita verso il tavolo", "Mantieni 20–30 secondi"], dosaggio: "5 ripetizioni, 3 volte al giorno", attenzione: "Allungamento dolce, senza dolore sulla cicatrice.", disegno: "mano-tavolo" })],
      ["du-est", E("rv-du-ventaglio", "Settimane 2–6", "Apertura delle dita a ventaglio", { obiettivo: "Allungare il palmo.", posizione: "Mano appoggiata sul tavolo.", passi: ["Apri le dita a ventaglio", "Mantieni 5 secondi e rilassa"], dosaggio: "10 ripetizioni, 3 volte al giorno", attenzione: "", disegno: "ventaglio" })],
      [null, E("rv-du-pinch", "Dopo 6 settimane", "Prendere piccoli oggetti", { obiettivo: "Recuperare i gesti fini.", posizione: "Seduto al tavolo.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" })],
    ],
    "tendini-estensori": [
      ["ex-tutore", E("rv-es-elev", "Settimane 0–3", "Mano sollevata e dita libere", { obiettivo: "Ridurre il gonfiore e muovere ciò che non è protetto.", posizione: "Mano sollevata, ortesi indossata.", passi: ["Tieni la mano più in alto del cuore", "Muovi le dita e le articolazioni NON bloccate dall’ortesi"], dosaggio: "Più volte al giorno", attenzione: "Non muovere l’articolazione protetta dall’ortesi.", disegno: "elevazione" })],
      ["ex-presa", E("rv-es-tavola", "Settimane 5–8", "Piegare le nocche (posizione a tavola)", { obiettivo: "Recuperare la flessione in modo controllato.", posizione: "Gomito appoggiato, mano verso l’alto.", passi: ["Parti con le dita dritte", "Piega solo le nocche tenendo le dita dritte"], dosaggio: "Secondo indicazione del terapista", attenzione: "Non forzare la flessione.", disegno: "flessione-mf" })],
      [null, E("rv-es-destrezza", "Settimane 8–12", "Rotazione di una pallina nel palmo", { obiettivo: "Destrezza e coordinazione.", posizione: "Seduto, palmo verso l’alto con una pallina piccola e leggera.", passi: ["Fai ruotare la pallina in un senso", "Poi nel senso opposto", "Mano rilassata: la pallina non va stretta"], dosaggio: "1 minuto per senso, 2 volte al giorno", attenzione: "Non stringere la pallina.", disegno: "rotazione-pallina" })],
    ],
    "tunnel-carpale": [
      ["ex-gliding", E("rv-tc-opp", "Settimana 1–3", "Pollice tocca ogni dito", { obiettivo: "Mobilità e coordinazione del pollice.", posizione: "Seduto, avambraccio appoggiato.", passi: ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"], dosaggio: "5 giri, 3 volte al giorno" + SDI, attenzione: "", disegno: "opposizione" })],
      [null, E("rv-tc-elev", "Post-operatorio", "Mano sollevata e dita in movimento", { obiettivo: "Ridurre gonfiore e dolore nei primi giorni.", posizione: "Mano più in alto del cuore.", passi: ["Apri completamente le dita", "Chiudi piano a pugno"], dosaggio: "10 volte ogni ora da sveglio", attenzione: "Medicazione asciutta.", disegno: "pugno-apri" })],
    ],
    "tfcc": [
      [null, E("rv-tf-pinch", "Fase 3 – Stabilità e forza", "Prendere piccoli oggetti", { obiettivo: "Gesti fini senza caricare il polso.", posizione: "Seduto al tavolo, avambraccio appoggiato.", passi: ["Prendi una moneta con pollice e indice", "Spostala in un contenitore"], dosaggio: "5 minuti, 2 volte al giorno", attenzione: "", disegno: "pinch-moneta" })],
    ],
    "frattura-scafoide": [
      [null, E("rv-sc-carico", "A guarigione confermata", "Appoggiarsi sul palmo", { obiettivo: "Tornare a caricare la mano.", posizione: "In piedi davanti al tavolo.", passi: ["Appoggia il palmo sul tavolo", "Sposta gradualmente il peso sulla mano"], dosaggio: "5 × 10 secondi", attenzione: "Solo con il via libera del medico.", disegno: "carico-tfcc" })],
    ],
  };
  /* passi riscritti per corrispondere alle figure */
  const PASSI = {
    "dito-a-scatto": { "ex-gliding-base": ["Dita dritte", "Tavola: nocche piegate, dita dritte", "Gancio: nocche dritte, dita piegate", "Pugno, poi torna a dita dritte"],
      "ex-gliding-avanzato": ["Dita dritte (2–3 secondi)", "Tavola (2–3 secondi)", "Gancio (2–3 secondi)", "Pugno dritto (2–3 secondi)", "Pugno completo, poi torna"] },
    "tunnel-carpale": { "ex-gliding": ["Dita estese", "Flessione a “gancio”", "Pugno completo, poi torna all’estensione"] },
    "rizoartrosi": { "rz-opp": ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"] },
    "frattura-radio-distale": { "rd-pollice": ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"] },
    "frattura-scafoide": { "sc-pollice": ["Pollice–indice", "Pollice–medio", "Pollice–anulare", "Pollice–mignolo"] },
  };
  /* dosi standard al posto di "secondo indicazione" (non per gli estensori: dipende dal protocollo) */
  const DOSE = [[/^gliding/, "10 ripetizioni, 3–4 volte al giorno"], [/ifp|blocking|ifd/, "10 ripetizioni, 3 volte al giorno"], [/^(polso|deviazioni|pronosupinazione)/, "10 ripetizioni, 3 volte al giorno"],
    [/^(opposizione|pollice)/, "5–10 ripetizioni, 3 volte al giorno"], [/^pinch/, "5 minuti, 2 volte al giorno"], [/^cicatrice/, "5 minuti, 2–3 volte al giorno"], [/^elastico/, "2 serie da 10, una volta al giorno"],
    [/^presa/, "Più volte al giorno nelle attività quotidiane"], [/^(ventaglio|pugno-apri|mano-tavolo)/, "10 ripetizioni, 3 volte al giorno"], [/^rotazione/, "1 minuto per senso, 2 volte al giorno"]];
  /* bibliografia per le brochure originali (fonti già usate nelle proposte di aggiornamento) */
  const BIB = {
    "dito-a-scatto": [["Huisstede B.M.A. et al. (2014). Multidisciplinary Consensus Guideline for Managing Trigger Finger: European HANDGUIDE Study. Physical Therapy", "w:d810a514-7b20-4449-add2-25b5c81df4c1"], ["Atthakomol P. et al. (2023). Splint alone, steroid alone, and combination for adults with trigger finger. Clinical Orthopaedics and Related Research", "w:7846194c-c942-4bb0-adf6-91037c5e613d"]],
    "de-quervain": [["Challoumas D. et al. (2023). Management of de Quervain Tenosynovitis: Systematic Review and Network Meta-Analysis. JAMA Network Open", "w:ad979f92-3742-4451-84c3-783967dd3867"], ["Huisstede B.M.A. et al. (2017). Conservative, surgical and postsurgical interventions for trigger finger, Dupuytren and De Quervain disease: a systematic review. Arch Phys Med Rehabil", "w:723cf0d5-af9d-4fc2-9821-1ed63b4c6694"]],
    "tunnel-carpale": [["Karjalainen T. et al. (2023). Splinting for carpal tunnel syndrome. Cochrane Database of Systematic Reviews", "w:b90fa07e-4494-410a-af69-5eac9e19f19d"], ["Peters S.E. et al. (2016). Rehabilitation following carpal tunnel release. Cochrane Database of Systematic Reviews", "w:1bfc09b2-b647-40c3-8e92-e9aca364fe41"]],
    "tendini-estensori": [["Handoll H.H.G. et al. (2004). Interventions for treating mallet finger injuries. Cochrane Database of Systematic Reviews", "w:c0ee6f0c-f88e-4e91-9360-389fbcb23e07"], ["O’Brien L. et al. (2011). Dorsal aluminum and custom thermoplastic splints versus Stack splint for acute mallet finger: RCT. Arch Phys Med Rehabil", "w:aa7f6c35-feac-4654-889b-a56ed6afc9e4"]],
  };

  window.REHAND_MIGRAZIONI = window.REHAND_MIGRAZIONI || [];
  window.REHAND_MIGRAZIONI.push({
    id: "2026-11-revisione",
    nota: "Revisione: più esercizi illustrati, passi allineati alle figure, dosi più chiare e bibliografia.",
    apply(doc) {
      let ch = false;
      const ex = doc.esercizi || (doc.esercizi = []);
      // passi allineati alle figure
      Object.entries(PASSI[doc.id] || {}).forEach(([id, passi]) => { const e = ex.find((x) => x.id === id); if (e) { e.passi = passi; ch = true; } });
      if (doc.id === "tunnel-carpale") { const e = ex.find((x) => x.id === "ex-neurodinamica"); if (e && !e.disegno) { e.disegno = "neurodinamica-mediano"; e.passi = ["Braccio teso di lato, polso e dita verso l’alto", "Porta lentamente polso e dita verso il basso, poi torna"]; ch = true; } }
      // nuovi esercizi
      (NUOVI[doc.id] || []).forEach(([dopo, n]) => {
        if (ex.some((x) => x.id === n.id)) return;
        let i = dopo ? ex.findIndex((x) => x.id === dopo) : -1;
        if (i < 0) { const j = ex.map((x) => x.fase).lastIndexOf(n.fase); i = j; }
        if (i < 0) ex.push(n); else ex.splice(i + 1, 0, n);
        ch = true;
      });
      // rigidità IFP: fasi distinte
      if (doc.id === "rigidita-ifp") {
        const F = { "ifp-est": "Settimane 1–3", "ifp-gliding": "Settimane 1–3", "ifp-blocking": "Settimane 3–6", "ifp-flex": "Settimane 3–6", "ifp-ortesi": "Settimane 1–3" };
        ex.forEach((e) => { if (F[e.id] && e.fase === "Esercizi chiave" || (F[e.id] && e.fase === "Ortesi")) { e.fase = F[e.id]; ch = true; } });
        const ord = ["Settimane 1–3", "Settimane 3–6", "Dopo 6 settimane"]; const pos = (f) => { const i = ord.indexOf(f); return i < 0 ? 9 : i; };
        doc.esercizi = ex.map((e, i) => [e, i]).sort((a, b) => pos(a[0].fase) - pos(b[0].fase) || a[1] - b[1]).map((x) => x[0]);
      }
      // dosi standard
      if (doc.id !== "tendini-estensori") (doc.esercizi || []).forEach((e) => {
        if (!e.dosaggio || /^secondo indicazione/i.test(e.dosaggio)) {
          const k = typeof e.disegno === "string" ? e.disegno : ""; const d = DOSE.find(([rx]) => rx.test(k));
          if (d && !/kleinert|place|tenodesi|tutore|spica/.test(k)) { e.dosaggio = d[1] + SDI; ch = true; }
        }
      });
      // bibliografia
      if (BIB[doc.id]) { doc.bibliografia = doc.bibliografia || []; BIB[doc.id].forEach(([t, u]) => { if (!doc.bibliografia.some((r) => (r.url || "").includes(u))) { doc.bibliografia.push({ testo: t, url: C(u) }); ch = true; } }); }
      return ch;
    },
  });
  // anche i contenuti originali dell'app partono già revisionati
  const m = window.REHAND_MIGRAZIONI[window.REHAND_MIGRAZIONI.length - 1];
  (window.SEED_DOCS || []).forEach((d) => { m.apply(d); d.migrazioni = (d.migrazioni || []).concat(m.id); });
})();
