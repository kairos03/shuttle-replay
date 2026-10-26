# Panoramica della tecnologia

`shuttle-replay` trasforma tre tipi di evidenza in un replay: un video
originale locale, rilevazioni 2D del volano che fornisci tu e vincoli che una
persona ha revisionato (punti di calibrazione, contatti e zone di
atterraggio). Questa pagina è la mappa. Le cinque pagine successive spiegano in
profondità ogni fase, e ogni pagina rimanda alle righe esatte del codice
sorgente che descrive, fissate al commit
`6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Flusso dei dati

```text
 source video (local file) ----------------------------------------+
                                                                   |
 calibration input JSON --> calibrate --> calibration JSON         |
 (ground points + net anchors)              (P, H, errors)         |
                                                 |                 |
 tracks JSON (your detections, PTS) -------------+                 |
 review JSON (contacts, flight ends) ------------+                 |
                                                 v                 v
                                       analyze --> analysis JSON --> render --> replay MP4
                                                                         +--> render report JSON
```

La CLI espone ogni freccia come un comando: `calibrate`, `analyze`, `render` e
`run` (analyze + render in un solo passo). `demo` costruisce una scena
interamente sintetica ed esegue su di essa la stessa pipeline
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
In `run`, il video viene renderizzato e verificato prima che vengano scritti
`analysis.json` e `render_report.json`, così i risultati JSON non descrivono
mai un video che è fallito
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

Che cosa aggiunge ogni fase:

1. **La calibrazione** trasforma le posizioni in pixel revisionate di punti
   noti del campo in un'omografia del pavimento `H` e in una matrice di
   telecamera 3x4 `P` per segmento di ripresa. Vedi
   [Calibrazione della telecamera](camera-calibration.md).
2. **La validazione degli input** controlla timestamp, segmenti, contatti e
   fini dei voli, e rifiuta le incoerenze invece di correggerle. Vedi
   [Osservazioni e tempi](observations-timing.md).
3. **L'adattamento dei voli** adatta un modello di gravità + resistenza
   quadratica alle rilevazioni 2D tra contatti revisionati. Vedi
   [Fisica della traiettoria](trajectory-physics.md).
4. **Il rendering** decodifica l'originale, disegna sovrapposizioni e una
   vista dall'alto del campo, copia i pacchetti audio e verifica il risultato
   prima di pubblicarlo. Vedi
   [Rendering e sicurezza dell'output](rendering-safety.md).
5. **La validazione** è distribuita su tutte le fasi. Che cosa dimostra ogni
   controllo, e che cosa no, è raccolto in
   [Validazione e limiti](validation-limits.md).

## Stack software

| Componente | Ruolo in questo progetto |
| --- | --- |
| Python 3.12+ | Linguaggio; `requires-python = ">=3.12"` in `pyproject.toml` |
| NumPy | Algebra lineare: DLT dell'omografia, SVD, proiezione, risoluzione degli ancoraggi ai minimi quadrati |
| SciPy | `solve_ivp` integra l'EDO del volo; `least_squares` adatta i voli |
| PyAV (`av`) | Binding FFmpeg nello stesso processo: decodifica, codifica, copia dello stream audio, verifica |
| Pillow | Disegna anelli, scie, il campo e testo su ogni fotogramma |
| uv | Installa l'ambiente bloccato (`uv.lock`) ed esegue i comandi |
| Sphinx + MyST + Furo | Genera questo sito di documentazione (il gruppo di dipendenze `docs`) |

Le dipendenze di runtime sono esattamente `numpy`, `scipy`, `av` e `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
Nessun sottoprocesso o comando di shell viene costruito a partire da nomi di
file; il lavoro sul video passa attraverso PyAV nello stesso processo Python
([docstring del modulo `render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Perché non è incluso alcun modello

Trovare un volano in un fotogramma (rilevazione) e stabilire dove si trova in
3D (ricostruzione) sono problemi distinti. Questo progetto fa solo il secondo,
e solo sotto ipotesi esplicite. Non ci sono rilevatori, reti neurali né pesi
di modello da scaricare. Porti tu le rilevazioni da qualunque strumento di cui
ti fidi, nel formato `shuttle-replay/tracks/v1` descritto in
[gli schemi](schemas.md).

Così ogni numero resta tracciabile. Ogni fotogramma dell'analisi etichetta la
posizione del volano con un livello di provenienza
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)):

- `observed_pixel`: la tua rilevazione, invariata, oppure nulla quando non
  c'era.
- `human_review`: un contatto, una zona di atterraggio o un punto di
  calibrazione inserito da una persona.
- `conditional_model`: il modello fisico adattato, che vale solo quanto la
  calibrazione e la revisione da cui dipende.
- `display_interpolation`: linee che il renderer disegna tra campioni del
  modello.

Una rilevazione mancata non viene mai riempita come se fosse stata osservata,
e il modello non viene mai etichettato come misura.

## Percorso di lettura consigliato

Se sei alle prime armi con la visione artificiale, leggi in questo ordine:

1. [Calibrazione della telecamera](camera-calibration.md): come i pixel si
   collegano ai metri, e perché una sola telecamera non può vedere la
   profondità da sola.
2. [Fisica della traiettoria](trajectory-physics.md): come la fisica e i
   contatti revisionati ricostruiscono la profondità mancante.
3. [Osservazioni e tempi](observations-timing.md): perché i timestamp vengono
   dal contenitore video e non da un contatore di fotogrammi.
4. [Rendering e sicurezza dell'output](rendering-safety.md): come l'MP4 viene
   costruito e protetto.
5. [Validazione e limiti](validation-limits.md): come leggere le diagnostiche
   e dove smettono di valere.

Per i passaggi pratici, vedi [Per iniziare](getting-started.md),
[la guida utente](guide.md) e [il flusso di lavoro](workflow.md).
