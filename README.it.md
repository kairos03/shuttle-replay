<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>Trasforma un video locale di badminton, le tue rilevazioni e la tua revisione in un replay con il campo affiancato. Offline.</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Offline">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">Avvio rapido</a> |
  <a href="#workflow">Flusso di lavoro</a> |
  <a href="#user-guide">Guida all’uso</a> |
  <a href="docs/schemas.md">Formati dei dati (in inglese)</a> |
  <a href="https://kairos03.github.io/shuttle-replay/it/">Documentazione</a>
</p>

## Panoramica

`shuttle-replay` calibra una telecamera a partire dai punti del campo che hai
revisionato, adatta traiettorie con gravità e resistenza quadratica alle
rilevazioni 2D del volano che fornisci e genera un MP4 con il video sorgente
accanto a una vista dall'alto del campo.

È uno strumento di ricerca e revisione, non un sistema di chiamata delle linee,
un classificatore di colpi, un rilevatore di volani né un misuratore di velocità
3D. Ogni posizione e velocità 3D è un output condizionale del modello che
dipende dalla tua calibrazione e dalle tue annotazioni.

## Installazione

Richiede Python 3.12+ e [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

I wheel di PyAV includono FFmpeg, quindi non serve FFmpeg di sistema.

## Perché usarlo

- **Completamente offline.** Nessun rilevatore, nessun peso di modello, nessuna chiamata di rete.
- **Prima la revisione umana.** Contatti, zone di atterraggio e punti di calibrazione li fornisci tu; nulla viene corretto in silenzio.
- **Livelli onesti.** Pixel osservati, la tua revisione e il modello condizionale restano separati nell'output.
- **Rendering sicuro.** L'audio sorgente viene copiato come flusso senza ricodifica e i file esistenti non vengono mai sovrascritti.

<a id="quick-start"></a>
## Avvio rapido

```bash
uv run shuttle-replay demo --out-dir demo
```

Scrive `demo/inputs/` (video sintetico, tracce, revisione, input di calibrazione),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` e `demo/synthetic_recovery.json`.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Replay della demo sintetica: vista sorgente accanto al campo visto dall'alto" width="90%">
  <br><sub>Dimostrazione sintetica generata da <code>demo</code>. Non è una misura dell'accuratezza nel mondo reale.</sub>
</p>

<a id="workflow"></a>
## Flusso di lavoro

Cosa devi fornire per il tuo video:

- **Rilevazioni** (`tracks.json`): una voce per ogni fotogramma decodificato con
  PTS, id del segmento di telecamera, pixel del volano o null e riquadri dei
  giocatori opzionali. Non c'è un rilevatore integrato.
- **Input di calibrazione**: per segmento, almeno 4 punti del campo `fit`,
  alcuni punti `heldout` e la sommità di entrambi i pali della rete (1.55 m).
- **Revisione** (`review.json`): tempi di contatto, pixel e altezze che hai
  revisionato, più zone di atterraggio opzionali. I contatti non vengono
  individuati automaticamente.

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<a id="user-guide"></a>

<details>
<summary><b>Guida passo passo per il tuo video</b></summary>

1. **Rilevazioni.** Produci una voce di `tracks.json` per ogni fotogramma
   decodificato con il PTS del fotogramma, un id di segmento di telecamera (null
   per stacchi o primi piani), il pixel del volano (o null) e riquadri dei
   giocatori opzionali. Vedi [docs/schemas.md](docs/schemas.md) (in inglese).
   Puoi usare qualsiasi tracker; ad esempio puoi eseguire tu stesso TrackNetV3
   (MIT) per il volano e un modello YOLO di Ultralytics (AGPL-3.0) per i
   giocatori con i tuoi checkpoint e convertirne gli output. Gli script di
   conversione non fanno parte della v0.1.
2. **Input di calibrazione.** Per ogni segmento di telecamera, misura ≥ 4
   intersezioni delle linee del campo (ruolo `fit`), qualcuna in più come
   `heldout` e la sommità dei due pali della rete (1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Controlla `heldout_summary` e `net_anchor_sensitivity` prima di proseguire.
3. **Revisione.** Scrivi `review.json`: tempi di contatto all'interno di
   intervalli revisionati, prior su pixel e altezza del contatto e, per
   l'ultima traiettoria di un segmento, una zona di atterraggio opzionale o
   `open`.
4. **Analisi e rendering.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Gli input incoerenti (PTS non monotoni, segmenti non contigui, contatti al di
   fuori del loro segmento o intervallo, PTS che non corrispondono al video, …)
   si interrompono con codice di uscita 2 e un messaggio; nulla viene corretto
   in silenzio.

</details>

<details>
<summary><b>Cosa fa ogni comando</b></summary>

- **Calibrazione** (`calibrate`): omografia da ≥ 4 punti del pavimento
  revisionati, più la colonna verticale della telecamera da ≥ 2 ancore
  sopraelevate della rete. I punti del pavimento tenuti da parte non vengono mai
  usati per l'adattamento e sono riportati separatamente (in pixel e metri). Gli
  input degeneri, duplicati, collineari e non finiti vengono rifiutati.
  L'omografia del pavimento non viene mai usata per i punti in volo.
- **Analisi** (`analyze`): una traiettoria per ogni contatto revisionato,
  cronometrata a partire dal contatto revisionato (tempo zero) anche quando la
  prima rilevazione arriva più tardi. Usa i PTS sorgente, gli id dei fotogrammi
  e gli id dei segmenti di telecamera; gli stacchi di telecamera sono esclusi e
  le traiettorie non attraversano mai i segmenti. Ogni traiettoria termina al
  contatto successivo (intercettata, non forzata ad atterrare), in una zona di
  atterraggio revisionata (un vincolo, non una coordinata misurata) o
  all'ultima osservazione del segmento. I controlli su pavimento e rete
  rifiutano adattamenti non fattibili. Quando una traiettoria è stata
  intercettata, il punto del pavimento che *avrebbe* raggiunto viene riportato
  separatamente come controfattuale. Le rilevazioni mancanti restano null.
- **Rendering** (`render`): verifica ogni fotogramma sorgente decodificato
  rispetto ai PTS delle tracce, disegna i riquadri dei giocatori forniti, gli
  anelli del volano osservato (verde) e del modello (arancione) e un campo visto
  dall'alto con un layout 6:4 tra sorgente e vista dall'alto. I fotogrammi con
  stacco di telecamera non ricevono la sovrapposizione del volano. I pacchetti
  audio sorgente vengono copiati come flusso senza modifiche (nessuna
  ricodifica), quindi l'offset iniziale e le interruzioni dell'audio sorgente
  vengono mantenuti; il rendering fallisce se l'audio non può essere copiato
  nell'MP4 o se la sua temporizzazione cambia. Nessun comando di shell viene
  costruito a partire dai nomi dei file. Gli output non vengono mai
  sovrascritti: il rendering fallisce se l'output esiste già o coincide con la
  sorgente, scrive su un file temporaneo univoco e lo pubblica solo dopo un
  controllo completo di decodifica.
- **Demo** (`demo`): genera uno scambio interamente sintetico (due telecamere
  virtuali, uno stacco di telecamera, rilevazioni rumorose con lacune, un tono
  di prova) ed esegue l'intera pipeline, incluso un rapporto di recupero della
  verità di riferimento sintetica.

</details>

<details>
<summary><b>Come leggere l'output</b></summary>

| Livello | Significato |
| --- | --- |
| `observed_pixel` | rilevazione fornita, invariata; null quando assente |
| `human_review` | i tuoi contatti, zone di atterraggio e punti di calibrazione |
| `conditional_model` | modello fisico adattato ai pixel osservati secondo i tuoi prior |
| `display_interpolation` | linee e marcatori disegnati solo dal renderer |

Le velocità sono la velocità iniziale del modello adattato (`model_speed_km_h`,
mostrata arrotondata a 5 km/h). Considerale valori indicativi del modello.

</details>

<details>
<summary><b>Limiti</b></summary>

- Nessun rilevamento del volano o dei giocatori. Fornisci tu le rilevazioni nel
  [formato delle tracce](docs/schemas.md) (in inglese); non viene scaricato
  alcun peso di modello.
- Nessuna individuazione automatica dei contatti né affinamento dei loro
  timestamp.
- Nessuna mappa di profondità densa appresa, nessuna etichetta di colpo appresa,
  nessuna chiamata automatica IN/OUT.
- L'output 3D è condizionale, non misurato. Un basso errore di riproiezione
  mostra coerenza con le rilevazioni 2D, non una prova indipendente
  dell'accuratezza 3D. I risultati del recupero sintetico sono sintetici.

</details>

<details>
<summary><b>Sviluppo</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>Licenza</b></summary>

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Vedi
[LICENSE](LICENSE) e [NOTICE.md](NOTICE.md) per le note di terze parti.

</details>
