/* Approvazione delle bozze preparate da Claude, su indicazione dell'amministratrice (17/11/2026). */
(function () {
  const IDS = ["tendini-flessori", "tfcc", "rizoartrosi", "frattura-radio-distale", "frattura-scafoide", "rigidita-ifp", "dupuytren", "crps", "rigidita-mf"];
  const MIG = {
    id: "2026-11-approvazione",
    nota: "Bozza approvata su indicazione dell’amministratrice.",
    apply(doc) {
      if (doc.stato !== "bozza" || !IDS.includes(doc.id)) return false;
      doc.stato = "approvata";
      return true;
    },
  };
  window.REHAND_MIGRAZIONI = window.REHAND_MIGRAZIONI || [];
  window.REHAND_MIGRAZIONI.push(MIG);
  (window.SEED_DOCS || []).forEach((d) => { MIG.apply(d); d.migrazioni = (d.migrazioni || []).concat(MIG.id); });
})();
