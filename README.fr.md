<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>Transformez une vidéo de badminton locale, vos détections et votre vérification en un replay du terrain côte à côte. Hors ligne.</b></p>

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
  <a href="#quick-start">Démarrage rapide</a> |
  <a href="#workflow">Déroulement</a> |
  <a href="#user-guide">Guide d’utilisation</a> |
  <a href="docs/schemas.md">Formats de données (en anglais)</a> |
  <a href="https://kairos03.github.io/shuttle-replay/">Documentation</a>
</p>

## Présentation

`shuttle-replay` calibre une caméra à partir de points du terrain que vous avez
vérifiés, ajuste des trajectoires avec gravité et traînée quadratique aux
détections 2D du volant que vous fournissez, et produit un MP4 où la vidéo
source est placée à côté d'une vue de dessus du terrain.

C'est un outil de recherche et de vérification, pas un système d'arbitrage des
lignes, ni un classificateur de coups, ni un détecteur de volant, ni un radar
mesurant la vitesse en 3D. Chaque position et chaque vitesse 3D est une sortie
de modèle conditionnelle qui dépend de votre calibration et de vos annotations.

## Installation

Nécessite Python 3.12+ et [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Les wheels PyAV incluent FFmpeg : aucun FFmpeg système n'est requis.

## Pourquoi l'utiliser

- **Entièrement hors ligne.** Aucun détecteur, aucun poids de modèle, aucun appel réseau.
- **La vérification humaine d'abord.** Les contacts, zones d'atterrissage et points de calibration viennent de vous ; rien n'est corrigé en silence.
- **Des couches honnêtes.** Les pixels observés, votre vérification et le modèle conditionnel restent séparés dans la sortie.
- **Un rendu sûr.** L'audio source est copié en flux sans réencodage, et les fichiers existants ne sont jamais écrasés.

<a id="quick-start"></a>
## Démarrage rapide

```bash
uv run shuttle-replay demo --out-dir demo
```

Écrit `demo/inputs/` (vidéo synthétique, pistes, vérification, entrée de calibration),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` et `demo/synthetic_recovery.json`.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Replay de démonstration synthétique : vue source à côté de la vue de dessus du terrain" width="90%">
  <br><sub>Démonstration synthétique générée par <code>demo</code>. Ce n'est pas une mesure de la précision en conditions réelles.</sub>
</p>

<a id="workflow"></a>
## Déroulement

Ce que vous devez fournir pour votre propre vidéo :

- **Détections** (`tracks.json`) : une entrée par image décodée avec le PTS,
  l'identifiant de segment de caméra, le pixel du volant ou null, et des boîtes
  de joueurs facultatives. Il n'y a pas de détecteur intégré.
- **Entrée de calibration** : par segment, au moins 4 points du terrain `fit`,
  quelques points `heldout`, et le sommet des deux poteaux du filet (1,55 m).
- **Vérification** (`review.json`) : instants, pixels et hauteurs de contact que
  vous avez vérifiés, plus des zones d'atterrissage facultatives. Les contacts ne
  sont pas trouvés automatiquement.

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<a id="user-guide"></a>

<details>
<summary><b>Guide pas à pas pour votre propre vidéo</b></summary>

1. **Détections.** Produisez une entrée `tracks.json` par image décodée avec le
   PTS de l'image, un identifiant de segment de caméra (null pour les coupes et
   gros plans), le pixel du volant (ou null) et des boîtes de joueurs
   facultatives. Voir [docs/schemas.md](docs/schemas.md) (en anglais).
   N'importe quel tracker convient ; par exemple, vous pouvez exécuter vous-même
   TrackNetV3 (MIT) pour le volant et un modèle YOLO d'Ultralytics (AGPL-3.0)
   pour les joueurs, avec vos propres checkpoints, puis convertir leurs sorties.
   Les scripts de conversion ne font pas partie de la v0.1.
2. **Entrée de calibration.** Pour chaque segment de caméra, mesurez ≥ 4
   intersections de lignes du terrain (rôle `fit`), quelques autres en
   `heldout`, et le sommet des deux poteaux du filet (1,55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Vérifiez `heldout_summary` et `net_anchor_sensitivity` avant d'aller plus loin.
3. **Vérification.** Rédigez `review.json` : instants de contact à l'intérieur
   d'intervalles vérifiés, a priori sur le pixel et la hauteur de contact, et,
   pour la dernière trajectoire d'un segment, une zone d'atterrissage
   facultative ou `open`.
4. **Analyse et rendu.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Les entrées incohérentes (PTS non monotones, segments non contigus, contacts
   hors de leur segment ou de leur intervalle, PTS qui ne correspondent pas à la
   vidéo, …) provoquent un arrêt avec le code de sortie 2 et un message ; rien
   n'est corrigé en silence.

</details>

<details>
<summary><b>Ce que fait chaque commande</b></summary>

- **Calibration** (`calibrate`) : homographie à partir de ≥ 4 points au sol
  vérifiés, plus la colonne verticale de la caméra à partir de ≥ 2 ancres de
  filet en hauteur. Les points au sol mis de côté ne servent jamais à
  l'ajustement et sont rapportés séparément (en pixels et en mètres). Les
  entrées dégénérées, dupliquées, colinéaires et non finies sont rejetées.
  L'homographie du sol n'est jamais utilisée pour les points en l'air.
- **Analyse** (`analyze`) : une trajectoire par contact vérifié, chronométrée à
  partir du contact vérifié (instant zéro) même lorsque la première détection
  arrive plus tard. Utilise les PTS source, les identifiants d'image et les
  identifiants de segment de caméra ; les coupes de caméra sont exclues et les
  trajectoires ne franchissent jamais d'un segment à l'autre. Chaque trajectoire
  se termine au contact suivant (interceptée, pas forcée d'atterrir), dans une
  zone d'atterrissage vérifiée (une contrainte, pas une coordonnée mesurée), ou
  à la dernière observation du segment. Des contrôles au sol et au filet
  rejettent les ajustements impossibles. Lorsqu'une trajectoire a été
  interceptée, le point au sol qu'elle *aurait* atteint est rapporté séparément
  comme contrefactuel. Les détections manquantes restent null.
- **Rendu** (`render`) : vérifie chaque image source décodée par rapport aux
  PTS des pistes, dessine les boîtes de joueurs fournies, les anneaux du volant
  observé (vert) et du modèle (orange), ainsi qu'une vue de dessus du terrain
  dans une mise en page source/vue de dessus 6:4. Les images de coupe de caméra
  n'ont aucune surimpression du volant. Les paquets audio source sont copiés en
  flux sans modification (pas de réencodage), ce qui conserve le décalage de
  départ et les trous de l'audio source ; le rendu échoue si l'audio ne peut pas
  être copié dans le MP4 ou si sa synchronisation change. Aucune commande shell
  n'est construite à partir de noms de fichiers. Les sorties ne sont jamais
  écrasées : le rendu échoue si la sortie existe ou désigne la source, écrit
  dans un fichier temporaire unique et ne le publie qu'après une vérification
  complète par décodage.
- **Démo** (`demo`) : génère un échange entièrement synthétique (deux caméras
  virtuelles, une coupe de caméra, des détections bruitées avec des trous, un son
  de test) et exécute toute la chaîne, y compris un rapport de reconstruction de
  la vérité terrain synthétique.

</details>

<details>
<summary><b>Lire la sortie</b></summary>

| Couche | Signification |
| --- | --- |
| `observed_pixel` | détection fournie, inchangée ; null si absente |
| `human_review` | vos contacts, zones d'atterrissage et points de calibration |
| `conditional_model` | modèle physique ajusté aux pixels observés selon vos a priori |
| `display_interpolation` | lignes et marqueurs dessinés uniquement par le moteur de rendu |

Les vitesses sont la vitesse initiale du modèle ajusté (`model_speed_km_h`,
affichée arrondie à 5 km/h). Considérez-les comme des valeurs de modèle
approximatives.

</details>

<details>
<summary><b>Limites</b></summary>

- Aucune détection du volant ni des joueurs. Vous fournissez les détections au
  [format des pistes](docs/schemas.md) (en anglais) ; aucun poids de modèle n'est téléchargé.
- Pas de détection automatique des contacts ni d'affinage de leurs horodatages.
- Pas de cartes de profondeur denses apprises, pas d'étiquettes de coups apprises, pas de décisions IN/OUT automatiques.
- La sortie 3D est conditionnelle, pas mesurée. Une faible erreur de
  reprojection montre la cohérence avec les détections 2D, pas une preuve
  indépendante de la précision 3D. Les résultats de reconstruction synthétique
  sont synthétiques.

</details>

<details>
<summary><b>Développement</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>Licence</b></summary>

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Voir
[LICENSE](LICENSE) et [NOTICE.md](NOTICE.md) pour les mentions relatives aux tiers.

</details>
