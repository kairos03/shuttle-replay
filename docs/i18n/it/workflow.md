# Flusso di lavoro

## Cosa fornisci

- **Rilevazioni** (`tracks.json`): una voce per fotogramma decodificato con
  PTS, id del segmento di telecamera, pixel del volano o null e riquadri dei
  giocatori opzionali. Non c'è un rilevatore integrato. Vedi [](schemas.md).
- **Input di calibrazione**: per segmento, almeno 4 punti del campo `fit`,
  alcuni punti `heldout` e la sommità di entrambi i pali della rete (1.55 m).
- **Revisione** (`review.json`): istanti di contatto, pixel e altezze che hai
  revisionato, più zone di atterraggio opzionali. I contatti non vengono
  trovati automaticamente.

Qualsiasi tracker può produrre le rilevazioni; per esempio puoi eseguire tu
stesso TrackNetV3 (MIT) per il volano e un modello Ultralytics YOLO
(AGPL-3.0) per i giocatori, con i tuoi checkpoint, e convertirne gli output.
Gli script di conversione non fanno parte della v0.1.

## Passaggi

1. **Calibrare.** Per ogni segmento di telecamera, misura ≥ 4 intersezioni
   delle linee del campo (ruolo `fit`), qualcun'altra come `heldout` e la
   sommità dei due pali della rete.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Controlla `heldout_summary` e `net_anchor_sensitivity` prima di procedere.
2. **Revisionare.** Scrivi `review.json`: istanti di contatto all'interno di
   intervalli revisionati, pixel del contatto e prior di altezza e, per
   l'ultimo volo di un segmento, una zona di atterraggio opzionale oppure
   `open`.
3. **Analizzare e renderizzare.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Input incoerenti (PTS non monotono, segmenti non contigui, contatti fuori
   dal loro segmento o intervallo, PTS che non corrisponde al video, …) si
   fermano con codice di uscita 2 e un messaggio; nulla viene corretto in
   silenzio.

## Cosa fa ogni comando

- **`calibrate`**: omografia da ≥ 4 punti del pavimento revisionati, più la
  colonna verticale della telecamera da ≥ 2 ancore elevate della rete. I
  punti del pavimento tenuti da parte non sono mai usati per l'adattamento e
  vengono riportati separatamente. Input degeneri, duplicati, collineari e non
  finiti vengono rifiutati. L'omografia del pavimento non è mai usata per
  punti in aria.
- **`analyze`**: un volo per ogni contatto revisionato, temporizzato a partire
  dal contatto revisionato. I cambi di inquadratura sono esclusi e i voli non
  attraversano mai i segmenti. Ogni volo termina al contatto successivo, in
  una zona di atterraggio revisionata (un vincolo, non una coordinata
  misurata) o all'ultima osservazione del segmento. I filtri di pavimento e
  rete rifiutano gli adattamenti non fattibili. Le rilevazioni mancanti
  restano null.
- **`render`**: verifica ogni fotogramma originale decodificato rispetto al
  PTS delle tracce e disegna i riquadri dei giocatori forniti, gli anelli del
  volano osservato (verdi), gli anelli del modello (arancioni) e una vista
  dall'alto del campo in un layout 6:4. L'audio originale viene copiato come
  stream senza ricodifica. Gli output esistenti non vengono mai sovrascritti.
- **`demo`**: genera uno scambio sintetico ed esegue l'intera pipeline.

## Leggere l'output

| Livello | Significato |
| --- | --- |
| `observed_pixel` | rilevazione fornita, invariata; null quando assente |
| `human_review` | i tuoi contatti, zone di atterraggio e punti di calibrazione |
| `conditional_model` | modello fisico adattato ai pixel osservati sotto i tuoi prior |
| `display_interpolation` | linee e marcatori disegnati solo dal renderer |

Le velocità sono la velocità iniziale del modello adattato
(`model_speed_km_h`, mostrata arrotondata a 5 km/h). Considerale valori
approssimativi del modello, non misurazioni.

## Limiti

- Nessuna rilevazione del volano o dei giocatori e nessun peso incluso.
- Nessuna individuazione automatica dei contatti né affinamento dell'istante
  di contatto.
- Nessuna mappa di profondità densa appresa, nessuna etichetta di colpo
  appresa, nessuna chiamata automatica IN/OUT.
- L'output 3D è condizionale, non misurato. I risultati di recupero sintetico
  sono sintetici.
