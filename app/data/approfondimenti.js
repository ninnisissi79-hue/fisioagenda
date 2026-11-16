/* Approfondimenti per il paziente: spiegano meglio le raccomandazioni più comuni.
   L'app li inserisce negli spazi liberi di brochure e opuscoli, solo se pertinenti
   ("chiavi" = parole che devono comparire nell'opuscolo; "sempre" = adatti a tutti).
   Contenuti di buona pratica clinica, prudenti: in caso di indicazioni diverse prevalgono quelle del curante. */
window.APPROFONDIMENTI = [
  { id: "allarme", sempre: true, escludi: ["frattura-radio-distale"], titolo: "Quando chiamare subito il centro",
    testo: "Contattaci senza aspettare il controllo se le dita diventano fredde, bianche o violacee, se il formicolio aumenta, se il dolore cresce invece di calare, se compare febbre o la ferita si arrossa, si scalda o perde liquido, oppure se improvvisamente non riesci più a muovere un dito come prima." },
  { id: "dolore-esercizi", chiavi: "esercizi|esercizio|mobilizzazione", titolo: "Quanto dolore è accettabile durante gli esercizi",
    testo: "Un leggero fastidio o una sensazione di tensione sono normali (fino a 3 su una scala da 0 a 10) se passano entro 30–60 minuti. Se il dolore è più forte, dura a lungo o aumenta il giorno dopo, riduci ampiezza e ripetizioni e parlane con il fisioterapista. Non forzare mai il movimento con l’altra mano se non ti è stato insegnato." },
  { id: "poco-spesso", chiavi: "esercizi|ripetizioni|volte al giorno", titolo: "Esercizi: poco ma spesso",
    testo: "Brevi sessioni distribuite nella giornata funzionano meglio di una sola lunga. Esegui i movimenti lentamente e in tutta l’ampiezza possibile, con una breve pausa tra una ripetizione e l’altra. Scegli momenti fissi (per esempio dopo i pasti) e segna sul diario cosa hai fatto: aiuta te e il terapista a capire come procede." },
  { id: "elevazione", chiavi: "sollevat|gonfiore|edema|cuore", titolo: "Perché tenere la mano sollevata",
    testo: "Il gonfiore rallenta la guarigione e rende le dita rigide e doloranti. Tieni la mano più in alto del cuore quando sei seduto o sdraiato (anche appoggiata su cuscini di notte) ed evita di lasciare il braccio a penzoloni. Aprire e chiudere spesso le dita fa da “pompa” e aiuta il liquido a tornare indietro. Togli anelli e braccialetti finché la mano è gonfia." },
  { id: "ghiaccio", chiavi: "ghiaccio|crioterapia|freddo", titolo: "Come usare il ghiaccio",
    testo: "Avvolgi il ghiaccio o la borsa del freddo in un panno sottile: mai a contatto diretto con la pelle o con la ferita. Applicalo per 10–15 minuti, poi fai una pausa di almeno un’ora. Controlla la pelle: se diventa molto bianca o perdi sensibilità, toglilo. Se la zona è poco sensibile usa il freddo solo se il curante te lo ha indicato." },
  { id: "cicatrice", chiavi: "cicatric", titolo: "Come massaggiare la cicatrice",
    testo: "Inizia solo quando la ferita è chiusa e i punti sono stati tolti. Usa una crema idratante neutra e premi con il polpastrello in modo deciso ma sopportabile, con piccoli cerchi e poi lungo la cicatrice, spostando la pelle sui piani sotto. Bastano 5 minuti, 2–3 volte al giorno. Nei primi mesi proteggi la cicatrice dal sole con una crema ad alta protezione." },
  { id: "cura-ortesi", chiavi: "ortesi|tutore|gesso", titolo: "Come curare l’ortesi",
    testo: "L’ortesi in materiale termoplastico si deforma con il calore: non lasciarla al sole, in auto o vicino a termosifoni e stufe. Lavala con acqua tiepida e sapone neutro e asciugala bene. Ogni volta che la togli controlla la pelle: un arrossamento che non sparisce in 20–30 minuti, vesciche o dolore vanno segnalati. Non tagliarla o modificarla da solo: portala in ambulatorio." },
  { id: "ferita", escludi: ["crps", "rizoartrosi", "tfcc"], chiavi: "ferita|medicazione|punti|intervento", titolo: "La ferita nei primi giorni",
    testo: "Tieni la medicazione pulita e asciutta: per lavarti puoi coprire la mano con un sacchetto. Non bagnare la ferita finché non ti viene detto. I punti si tolgono di solito dopo 10–14 giorni. Un po’ di gonfiore e di sensibilità intorno alla ferita sono normali e migliorano con il passare dei giorni." },
  { id: "scorrimento", chiavi: "scorrimento|gliding|aderenz", titolo: "Perché lo scorrimento tendineo è importante",
    testo: "I tendini scivolano dentro guaine sottili, come cavi in una guaina. Dopo un trauma o un intervento tendono a incollarsi ai tessuti vicini (aderenze), limitando il movimento. Gli esercizi di scorrimento li fanno muovere separatamente e con delicatezza: per questo vanno ripetuti spesso, anche quando la mano sembra stare già meglio." },
  { id: "notte", chiavi: "notte|notturn|risveglia", titolo: "Di notte",
    testo: "Durante il sonno tendiamo a tenere il polso e le dita piegati, posizione che può aumentare dolore, formicolio e rigidità. Se ti è stata data un’ortesi notturna, indossala ogni notte. Appoggia la mano su un cuscino accanto a te e cerca di non dormire sopra il braccio o con il polso piegato sotto il viso." },
  { id: "ergonomia", chiavi: "presa|ergonom|ripetitiv|smartphone|lavoro", titolo: "Proteggere la mano nella vita di tutti i giorni",
    testo: "Preferisci impugnature grandi e morbide (penne spesse, manici imbottiti), usa entrambe le mani per sollevare e tieni gli oggetti vicini al corpo. Alterna le attività ripetitive con brevi pause ogni 30–45 minuti ed evita prese strette e prolungate o torsioni forzate, come strizzare panni o svitare barattoli duri." },
  { id: "ritorno", escludi: ["frattura-radio-distale"], chiavi: "ritorno|lavor|attività quotidiane|sport", titolo: "Tornare a guidare, lavorare e fare sport",
    testo: "Il ritorno alle attività va concordato con il medico e il terapista. Per guidare devi poter tenere e girare il volante in sicurezza e usare tutti i comandi senza dolore. Al lavoro e nello sport aumenta il carico gradualmente: prima attività leggere, poi più impegnative. Un aumento del dolore il giorno dopo è il segnale che sei andato troppo veloce." },
  { id: "desensibilizzazione", chiavi: "sensib|desensibil|formicol", titolo: "Se la zona è troppo sensibile",
    testo: "Dopo un intervento o una lesione la pelle può essere molto sensibile al tocco. Tocca e strofina la zona più volte al giorno con materiali diversi, dal più morbido (cotone, seta) al più ruvido (spugna, asciugamano), per pochi minuti. Se il fastidio diminuisce, passa al materiale successivo: il sistema nervoso si riabitua gradualmente." },
  { id: "calore", chiavi: "rigidit|rigid|stretching", titolo: "Calore prima degli esercizi",
    testo: "Se la mano è rigida ma non gonfia e non ci sono ferite aperte, immergerla in acqua tiepida per 5–10 minuti prima degli esercizi può rendere i tessuti più elastici e il movimento più facile. Muovi le dita anche mentre sono in acqua. Se la mano è gonfia o calda, preferisci il freddo e la mano sollevata." },
  { id: "pazienza", sempre: true, titolo: "I tempi della guarigione",
    testo: "Tendini, legamenti e ossa hanno bisogno di settimane per guarire e di mesi per tornare forti. È normale avere giorni migliori e giorni peggiori. Rispettare le fasi del programma, senza saltare avanti, protegge il risultato: ogni fase prepara la successiva." }
];
