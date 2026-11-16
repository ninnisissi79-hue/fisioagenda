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
  // anche i contenuti originali dell'app partono già corretti
  (window.SEED_DOCS || []).forEach((d) => window.REHAND_MIGRAZIONI.forEach((m) => { m.apply(d); d.migrazioni = (d.migrazioni || []).concat(m.id); }));
})();
