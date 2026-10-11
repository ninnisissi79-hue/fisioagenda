# Hand Lab – verifiche

## 1. Verifiche automatiche eseguite (ottobre 2026)

| Comando | Esito | Contenuto |
|---|---|---|
| `npm run typecheck` | ✅ nessun errore | shared, server, web |
| `npm test -w shared` | ✅ 32/32 | motori degli esercizi con tocchi simulati, aderenza, progressione, versioni, confrontabilità, CSV |
| `npm test -w server` | ✅ 20/20 | autenticazione, autorizzazioni, versioni del programma, sincronizzazione idempotente, tarature, correzioni, esportazioni, backup |
| `./e2e/prepare.sh && npm run e2e` | ✅ 20/20 | percorso completo in Chromium con tocchi multipli simulati (CDP) |

### Cosa è stato verificato, punto per punto

**Gestione dei contatti multipli**
* Associazione contatto → dito per vicinanza alla posizione di riferimento, non per identificativo del puntatore (unità).
* Pinza con due contatti simultanei nel browser: 12/12 ripetizioni contate (e2e).
* Un contatto lontano viene registrato come "non assegnato"; due contatti non possono essere assegnati allo stesso dito (unità).
* Verifica guidata del touchscreen: conta i contatti realmente rilevati (3 simulati → 3 rilevati) (e2e).

**Perdita del contatto, pausa e ripresa**
* Sollevare un dito durante la ripetizione: tentativo non valido, messaggio "Appoggia: Indice", contatto perso conteggiato; il dito che ricompare con un nuovo identificativo viene riassociato (unità + e2e).
* Pausa manuale: il tempo in pausa e il riposo tra le serie non entrano nel tempo attivo (unità).

**Interruzione quando l'app passa in secondo piano**
* `visibilitychange` → pausa automatica con messaggio dedicato; ripresa solo manuale (e2e).
* Chiusura dell'app durante un esercizio: alla riapertura seduta ed esercizio vengono registrati come interrotti ("App chiusa durante l'esercizio") – implementato tramite stato salvato ogni 5 s; *non coperto da test automatico*.

**Cambio di orientamento / dimensioni**
* Ridimensionamento dell'area: pausa, "Riprendi" disabilitato finché l'area non torna alle dimensioni iniziali, poi riposizionamento delle dita (e2e).
* Difetto trovato e corretto durante le prove: un avviso che compariva sopra l'area la spostava, falsando le coordinate registrate. Ora gli avvisi sono sovrapposti e l'area non cambia.

**Tarature versionate**
* Procedura guidata completa nel browser (dita una alla volta, disposizione simultanea, aree confortevoli per pinza/scorrimento/area di movimento, prova, salvataggio) (e2e).
* Una nuova taratura diventa la versione successiva, la precedente resta e resta "di riferimento"; reinvio dello stesso identificativo senza duplicati (server).

**Integrità dei dati dopo riapertura / offline**
* Seduta svolta interamente offline con il programma salvato sul tablet; dati in coda ("attività da inviare"); al ritorno della rete invio automatico (e2e).
* Il server riceve una sola seduta e una sola esecuzione per elemento, con versione del programma eseguita, motivo di interruzione e sintomi (e2e).

**Esportazione e importazione senza duplicazioni**
* Reinvio forzato di un'esecuzione già ricevuta: nessun duplicato (server + e2e).
* Uno stato provvisorio arrivato in ritardo non sovrascrive uno stato definitivo (server).
* Copia di sicurezza JSON reimportata due volte: nessun duplicato; file di un altro paziente rifiutato (server).

**Calcolo delle metriche**
* Pinza: distanze, escursione, mm solo con calibrazione fisica, mantenimento obbligatorio, limite di tentativi (unità).
* Scorrimento: deviazione dalla traiettoria, uscita delle dita ferme dalla zona (unità).
* Pianoforte: risposte corrette, dito sbagliato, omissioni, tempi di reazione, sequenza casuale riproducibile (unità).
* Segui la strada: quota nel tracciato, scorciatoie fuori strada non fanno avanzare, percorso speculare per la sinistra (unità).
* Insegui il bersaglio: il tempo a dito sollevato non conta e il bersaglio aspetta (unità).

**Separazione prove a condizioni fisse / allenamento**
* Grafici distinti; condizioni (difficoltà, taratura, tablet, versione) diverse mostrate come serie distinte con avviso; confronto tra esecuzioni con elenco delle differenze (unità `comparabilityIssues` + revisione visiva).
* Le prove a condizioni fisse non ammettono progressione (validazione).

**Accessi e aggiornamenti**
* Il paziente vede solo i propri dati; il professionista solo i pazienti assegnati e secondo il livello; revoca effettiva; amministratore senza accesso clinico; protezione CSRF; blocco dopo tentativi ripetuti; password e token salvati solo come hash (server).
* Programma: nuova versione con decorrenza futura; il paziente oggi riceve ancora la versione in vigore e quella futura come "in arrivo"; conflitto se due professionisti modificano la stessa versione; decorrenza nel passato rifiutata (server + e2e).
* "Nessuna attività ricevuta" ≠ "non effettuato": distinzione basata sulla conferma di coda vuota da parte di ogni tablet (unità + server).

### Limiti delle verifiche automatiche
* I tocchi sono **simulati** in Chromium desktop: non riproducono il comportamento reale dei touchscreen (palmo, pressione, gesti di sistema, limiti hardware, latenza).
* Safari/iPadOS non è stato provato automaticamente.
* Non sono stati eseguiti test di carico, di sicurezza approfonditi (penetration test) né di accessibilità con lettori di schermo.

## 2. Richiedono prove su dispositivi fisici

1. Numero reale di contatti simultanei rilevati su ciascun modello di tablet.
2. Comportamento di Safari iPadOS con 4–5 dita (gesti multitasking di sistema, `pointercancel`).
3. Blocco di zoom/scorrimento solo nell'area dell'esercizio (Safari ignora `user-scalable`).
4. Installazione sulla schermata Home (richiede HTTPS) e funzionamento offline dopo la chiusura.
5. Pausa reale quando si preme Home, arriva una notifica o si blocca lo schermo.
6. Rotazione reale del tablet durante un esercizio.
7. Ergonomia: dimensione dei bersagli, leggibilità, posizione della mano per mano destra e sinistra.
8. Calibrazione fisica con tessera: ripetibilità su più misure.

## 3. Procedura di prova fisica del multitouch (iPad e Android)

Preparazione
* Server raggiungibile in HTTPS dal tablet (rete locale con certificato valido o servizio di test interno) e database dimostrativo (`npm run seed`).
* Tablet carico, custodia rimossa se copre i bordi, luminosità alta, mani asciutte.
* iPad: Impostazioni → Schermo Home e multitasking → disattivare temporaneamente "Gesti" (multitasking con 4–5 dita) e annotare se attivi.
* Annotare: modello, versione del sistema, browser e versione, app installata o da browser.

Prove (ripetere 3 volte, prima dal browser poi dall'app installata)
1. **Verifica touchscreen** (Impostazioni → Verifica touchscreen): appoggiare 1, 2, 3, 4, 5 dita. Annotare il massimo rilevato, i contatti annullati dal sistema e l'esito della ricomparsa del dito.
2. **Zoom e scorrimento**: nell'area dell'esercizio provare pizzico e trascinamento con due dita: la pagina non deve zoomare né scorrere. Fuori dall'area (es. istruzioni) lo zoom deve restare possibile.
3. **Pinza sul piano** (account `demo001`, oppure Esercizi → Prova): 5 ripetizioni; verificare il conteggio e che il mantenimento sia richiesto.
4. **Perdita del contatto**: durante una ripetizione sollevare l'indice: deve comparire "Appoggia: Indice" e la ripetizione non deve contare; riappoggiarlo e continuare.
5. **Pianoforte con 3 dita**: sollevare il dito indicato, poi intenzionalmente un dito sbagliato: verificare "dita sbagliate" nei risultati.
6. **Scorrimento con pollice fermo** (aggiungere al programma "Scorrimento" con Indice + Pollice): spostare il pollice fuori zona e verificare che la ripetizione non sia valida.
7. **Secondo piano**: durante un esercizio premere Home / cambiare app per 10 s, tornare: l'esercizio deve essere in pausa; il tempo attivo non deve includere l'assenza.
8. **Rotazione**: ruotare il tablet in verticale: pausa con "Riprendi" disabilitato; tornare in orizzontale e riprendere.
9. **Offline**: attivare la modalità aereo, completare una seduta, chiudere l'app, riaprirla (ancora offline): il programma deve comparire e le attività risultare "da inviare"; disattivare la modalità aereo: devono risultare inviate e visibili al fisioterapista una sola volta.
10. **Chiusura forzata**: chiudere l'app durante un esercizio e riaprirla: nella scheda del fisioterapista l'esercizio deve risultare "interrotto – App chiusa durante l'esercizio".
11. **Mano sinistra** (`demo002`): verificare la disposizione speculare di bersagli e percorsi.

Registrazione dei risultati: per ogni prova annotare esito (OK / problema), descrizione, screenshot. Se un esercizio non è supportato (contatti insufficienti), verificare che l'app lo segnali e proponga l'alternativa.
