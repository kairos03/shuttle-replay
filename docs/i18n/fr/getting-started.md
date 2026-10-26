# Prise en main

## Installation

Nécessite Python 3.12+ et [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Les wheels PyAV incluent FFmpeg, donc aucun FFmpeg système n'est requis.

## Démarrage rapide

```bash
uv run shuttle-replay demo --out-dir demo
```

Cette commande écrit `demo/inputs/` (vidéo synthétique, pistes, revue, entrée
de calibration), `demo/calibration.json`, `demo/analysis.json`,
`demo/replay.mp4`, `demo/render_report.json` et `demo/synthetic_recovery.json`.

La démo est entièrement synthétique : deux caméras virtuelles, un changement
de plan, des détections bruitées avec des trous et un signal de test audio.
Son rapport de reconstruction compare uniquement à une vérité terrain
synthétique et ne dit rien de l'exactitude sur une vraie vidéo.

Ensuite : [lancez-le sur votre propre vidéo](workflow.md).
