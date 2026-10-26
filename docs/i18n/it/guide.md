# Guida utente di shuttle-replay (v0.1)

`shuttle-replay` è uno strumento offline che crea un replay del volano da
badminton a partire da un video locale, da rilevazioni che hai già prodotto e
da annotazioni revisionate da una persona. Calibra la telecamera, adatta alle
coordinate di rilevazione 2D un modello di volo con gravità e resistenza
aerodinamica quadratica, e produce un MP4 che affianca il video originale e
una vista dall'alto del campo in proporzione 6:4.

Questo strumento è pensato per ricerca e revisione. Non è un sistema di
giudizio dentro/fuori, un classificatore di colpi, un rilevatore di volano né
un misuratore di velocità. Ogni posizione e velocità 3D nell'output è un
valore condizionale del modello che presuppone la tua calibrazione e le tue
annotazioni.

## Installazione

Richiede Python 3.12 o successivo e [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

I wheel di PyAV includono FFmpeg, quindi non serve un FFmpeg di sistema.

## Demo sintetica

```bash
uv run shuttle-replay demo --out-dir demo
```

Questo crea uno scambio sintetico che combina due telecamere virtuali, un
segmento di transizione e rilevazioni mancanti, poi esegue calibrazione →
analisi → rendering dall'inizio alla fine. I valori in
`demo/synthetic_recovery.json` sono confrontati con la verità di riferimento
sintetica, quindi non indicano l'accuratezza su video reali.

## Usare il proprio video

1. **Rilevazioni (`tracks.json`)**: una riga per fotogramma decodificato, con
   il PTS effettivo di quel fotogramma (secondi), l'id del segmento di
   telecamera (`null` per segmenti di transizione e primi piani), le
   coordinate in pixel del volano (`null` quando assente) e riquadri dei
   giocatori opzionali. `frame_id` deve corrispondere all'ordine di
   decodifica. Vedi [docs/schemas.md](schemas.md) per il formato.
   La v0.1 non ha un rilevatore. Puoi eseguire tu stesso TrackNetV3 (MIT) o
   Ultralytics YOLO (AGPL-3.0) e convertire i risultati, ma non è incluso
   alcuno script di conversione. Non viene scaricato alcun peso di modello.
2. **Input di calibrazione**: per ogni segmento di telecamera, segna in pixel
   quattro o più intersezioni delle linee del campo (`fit`), alcune
   intersezioni per la validazione (`heldout`) e la sommità dei due pali della
   rete (altezza 1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Controlla prima `heldout_summary` (l'errore sui punti non usati per
   l'adattamento) e `net_anchor_sensitivity` (quanto si sposta l'altezza
   quando i pali della rete vengono spostati dell'errore in pixel indicato).
   L'omografia del pavimento è usata solo per punti a terra (Z=0) e mai per il
   volano in aria.
3. **Annotazioni di revisione (`review.json`)**: inserisci l'istante del
   contatto con la racchetta (`time_s`), l'intervallo di revisione che lo
   contiene (`time_bracket_s`), il pixel del contatto e una stima
   dell'altezza. L'istante del contatto è il secondo 0 del volo. Una prima
   rilevazione tardiva non cambia il secondo 0.
   Solo l'ultimo contatto di un segmento può avere una condizione finale: una
   `landing_region` (l'area e l'intervallo di tempo in cui il volano tocca
   terra) oppure `open` (fino all'ultima osservazione del segmento, o fino
   all'`until_s` revisionato). Ogni altro volo termina al contatto successivo
   e non è forzato a toccare terra. La v0.1 non corregge automaticamente gli
   istanti di contatto, quindi correggili tu guardando i fotogrammi.
4. **Analisi e rendering**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Il commento `# 한 번에:` significa "tutto in un solo passaggio:"; `run`
   esegue analisi e rendering insieme.

   Lo strumento si ferma con codice di uscita 2 se il PTS torna indietro, se
   lo stesso segmento di telecamera ricompare dopo una lacuna, se un contatto
   cade fuori dal suo segmento di telecamera o dall'intervallo di revisione, o
   se il PTS del video e il PTS delle tracce differiscono. Non corregge mai
   l'input in silenzio.

## Leggere i risultati

- Cerchio verde: le coordinate di rilevazione in input così come fornite. I
  fotogrammi senza rilevazione restano vuoti.
- Cerchio/punti arancioni: il modello fisico condizionale. Disegnato solo
  all'interno dello stesso segmento di telecamera e dello stesso volo.
- Riquadro blu tratteggiato: la zona di atterraggio indicata da una persona.
  Il segno × è il punto di atterraggio del modello adattato con quella zona
  come condizione, non una coordinata misurata.
- La velocità è la velocità iniziale del modello arrotondata a 5 km/h.
- Per un volo ribattuto, il punto "dove sarebbe atterrato se non fosse stato
  ribattuto" è registrato solo nel JSON
  (`unreturned_floor_crossing_prediction`, una previsione controfattuale).
- Se l'originale ha l'audio, i pacchetti audio vengono copiati così come sono
  senza ricodifica, quindi il ritardo iniziale e le lacune dell'audio
  originale vengono preservati. Se l'audio non può essere copiato nell'MP4 o
  la sua temporizzazione cambierebbe, il rendering fallisce. Il risultato
  della decodifica del file di output fino alla fine per verifica viene
  scritto in `render_report.json`.
- I file esistenti non vengono mai sovrascritti. Lo strumento si ferma se un
  file di output esiste già o è lo stesso file del video originale, e il
  rendering scrive in un file temporaneo che viene spostato al nome finale
  solo dopo la verifica.

## Licenza

Solo GNU AGPL-3.0. Vedi [LICENSE](../LICENSE) e [NOTICE.md](../NOTICE.md).
