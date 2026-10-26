# Calibrazione della telecamera

La calibrazione risponde a una domanda: per un punto del campo, in metri, in
quale pixel lo mostra la telecamera? `shuttle-replay` risponde con una
telecamera pinhole lineare stimata a partire da punti che hai localizzato a
mano. Questa pagina spiega i sistemi di coordinate, le due matrici che lo
strumento calcola, l'algoritmo esatto e il significato degli errori riportati.

## Due sistemi di coordinate

**Le coordinate immagine** `(u, v)` sono pixel del video originale: `u` cresce
verso destra, `v` cresce verso il basso.

**Le coordinate mondo** `(X, Y, Z)` sono metri in un sistema del campo fissato
dalle dimensioni del campo BWF
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)):

```text
      X = 0                X = 6.10
 Y = 0  +--------------------+   far baseline (outer edge)
        |                    |
        |                    |
 Y=6.70 |====== net =========|   net plane; posts 1.55 m, centre 1.524 m
        |                    |
        |                    |
Y=13.40 +--------------------+   near baseline (outer edge)

 Z is up; Z = 0 is the court surface.
```

Le linee sono larghe 40 mm e i punti di calibrazione usano **i centri delle
linee**: linee esterne a X = 0.02 / 6.08 e Y = 0.02 / 13.38, linee laterali
del singolo a X = 0.48 / 5.62, linee di servizio corto a Y = 4.70 / 8.70,
linee di servizio lungo del doppio a Y = 0.78 / 12.62, linea centrale X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Inserire un bordo esterno dove è atteso un centro sposta quel punto di 2 cm.

## Proiezione pinhole

Una telecamera pinhole associa un punto del mondo a un pixel con una matrice
3x4 `P`:

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

La divisione per `c` è la prospettiva: le cose lontane appaiono piccole. `P`
combina dove si trova la telecamera e come è ruotata (i parametri estrinseci)
con la sua lunghezza focale e il centro dell'immagine (gli intrinseci). Il
progetto non scompone mai `P` in queste parti; usa `P` come un'unica matrice
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
Il centro della telecamera `C` è l'unico punto con `P * [C, 1] = 0`, quindi
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Passo 1: l'omografia del pavimento (solo Z = 0)

Per i punti sul pavimento, `Z = 0`, quindi la terza colonna di `P` viene
moltiplicata per zero e scompare:

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

La matrice 3x3 `H = [p1 p2 p4]` è un'**omografia**. Viene stimata dai tuoi
punti a terra `role: "fit"` con la trasformazione lineare diretta (DLT)
normalizzata in
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78):

1. Ogni insieme di punti viene traslato nel suo baricentro e scalato in modo
   che la distanza media dal baricentro sia `sqrt(2)`
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   Questo mantiene ben condizionato il sistema lineare quando i valori in pixel
   sono nell'ordine delle centinaia e i metri hanno una sola cifra.
2. Ogni corrispondenza aggiunge due righe a un sistema lineare `A h = 0`.
3. `h` è il vettore singolare destro di `A` per il valore singolare più
   piccolo; la normalizzazione viene annullata e `H` viene scalata in modo che
   `H[2, 2] = 1`.

Gli input degeneri vengono rifiutati con `CalibrationError` invece di produrre
una matrice sbagliata: meno di quattro punti di fit, coordinate duplicate,
insiemi di punti collineari, tre punti collineari su esattamente quattro, un
secondo valore singolare più piccolo sotto `1e-9` volte il più grande
(soluzione non unica), o un numero di condizionamento sopra `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

Il fit è una DLT normalizzata che minimizza un residuo algebrico su tutti i
punti di fit, senza raffinamento non lineare della riproiezione. Non c'è
rifiuto degli outlier (niente RANSAC) né modello di distorsione dell'obiettivo:
un punto digitato male o una forte distorsione a barilotto trascina l'intero
fit.

`H` descrive solo il pavimento. L'output lo indica in `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Retroproiettare un pixel del volano attraverso `H` risponde a "dove sarebbe
questo pixel se fosse sul pavimento", il che è sbagliato per qualsiasi cosa in
aria.

## Passo 2: la colonna verticale dagli ancoraggi della rete

I punti del pavimento non dicono nulla su `p3`, la colonna che moltiplica
l'altezza. Servono punti di altezza nota che non siano sul pavimento:
normalmente le due sommità dei pali della rete a `Z = 1.55`. Per un
ancoraggio in `(X, Y, Z)` visto in `(u, v)`, scrivi `q = H * [X, Y, 1]`. La
condizione di proiezione diventa lineare in `p3`:

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
impila queste righe, richiede rango 3, risolve ai minimi quadrati e assembla
`P = [h1 h2 p3 h3]`, dove `h1`, `h2`, `h3` sono le colonne di `H`. Tre
incognite e due righe per ancoraggio significano che due ancoraggi danno
quattro equazioni: un sistema quasi esattamente determinato. Per questo un
residuo di ancoraggio piccolo (`net_anchor_residuals_px`) dimostra poco. Gli
ancoraggi devono essere sopraelevati (`Z > 0.1 m`) e devono essere almeno due.

Infine
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
rifiuta una telecamera il cui centro non sia sopra il pavimento, o una che
collocherebbe alcuni punti del campo davanti a sé e altri dietro.

## Punti di fit e punti di controllo

Ogni punto a terra ha un ruolo
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)):

- I punti `fit` costruiscono `H`. I loro residui (`fit_ground_residuals`) sono
  errore di addestramento e ci si aspetta che siano piccoli.
- I punti `heldout` non vengono mai usati per il fit. Ne serve almeno uno.
  `heldout_ground_errors` riporta, per punto, `error_px` (`H` applicata al
  punto del mondo, confrontata con il tuo pixel) ed `error_m` (l'inversa di
  `H` applicata al tuo pixel, confrontata con il punto del mondo).
  `heldout_summary` fornisce conteggio, media e massimo di entrambi.

Un esempio concettuale: i quattro angoli esterni come `fit` e due incroci di
linee di servizio come `heldout`. Se gli errori di controllo sono molto più
grandi dei residui di fit, un punto è etichettato male, è stato cliccato il
bordo di una linea invece del suo centro, oppure l'obiettivo curva le linee.
L'errore di controllo verifica solo la mappatura del pavimento; non dice nulla
sulle altezze.

## Sensibilità, non un intervallo di confidenza

Le altezze dipendono quasi interamente dagli ancoraggi.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
prende un punto di riferimento `(3.05, 6.70, 3.0)`, 3 m sopra la linea
centrale della rete, e lo proietta con `P`. Poi, per ogni ancoraggio e per `u`
e `v` separatamente, sposta il pixel dell'ancoraggio di `+uncertainty_px` e
`-uncertainty_px` (predefinito 3.0), risolve di nuovo `P` e interseca il raggio
passante per lo stesso pixel di riferimento con il piano della rete
`Y = 6.70`. `max_vertical_shift_m` è la variazione di altezza più grande. Se
una perturbazione fa fallire la soluzione, lo spostamento viene riportato come
infinito.

È un caso peggiore con una perturbazione alla volta per un singolo punto. Non
è un intervallo di confidenza statistico, non combina errori di più ancoraggi
e non include l'errore dei punti a terra.

## Ipotesi che stai facendo

- Una telecamera fissa per `segment_id`; un movimento di camera o uno zoom
  richiede un nuovo segmento.
- Le linee rette restano rette nell'immagine (nessuna distorsione
  dell'obiettivo).
- Gli ancoraggi hanno le altezze che inserisci. Le sommità dei pali a 1.55 m e
  il centro della rete a 1.524 m sono altezze diverse.
- Il piano del pavimento non è il volano. `H` fornisce posizioni sul
  pavimento; la profondità del volano deriva solo dal fit fisico descritto in
  [Fisica della traiettoria](trajectory-physics.md).

Vedi [gli schemi](schemas.md) per tutti i campi di input e output e
[Validazione e limiti](validation-limits.md) per leggere gli errori insieme
alle diagnostiche di volo.
