# Guide d'utilisation de shuttle-replay (v0.1)

`shuttle-replay` est un outil hors ligne qui construit un replay du volant de
badminton à partir d'une vidéo locale, de détections que vous avez déjà
produites et d'annotations vérifiées par une personne. Il calibre la caméra,
ajuste aux coordonnées 2D des détections un modèle de vol avec gravité et
traînée aérodynamique quadratique, et produit un MP4 qui place la vidéo source
et une vue de dessus du terrain côte à côte au format 6:4.

Cet outil sert à la recherche et à la revue. Ce n'est pas un système
d'arbitrage in/out des lignes, un classificateur de coups, un détecteur de
volant ni un radar de vitesse mesurée. Chaque position et vitesse 3D de la
sortie est une valeur conditionnelle du modèle qui suppose votre calibration et
vos annotations.

## Installation

Nécessite Python 3.12 ou plus récent et [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Les wheels PyAV embarquent FFmpeg, donc un FFmpeg système n'est pas
nécessaire.

## Démo synthétique

```bash
uv run shuttle-replay demo --out-dir demo
```

Cette commande construit un échange synthétique qui mélange deux caméras
virtuelles, un segment de transition et des détections manquantes, puis
exécute calibration → analyse → rendu de bout en bout. Les valeurs de
`demo/synthetic_recovery.json` sont comparées à la vérité terrain synthétique
et n'indiquent donc pas l'exactitude sur une vraie vidéo.

## Utiliser votre propre vidéo

1. **Détections (`tracks.json`)** : une ligne par image décodée, avec le PTS
   réel de cette image (en secondes), l'id du segment de caméra (`null` pour
   les segments de transition et les gros plans), les coordonnées en pixels du
   volant (`null` en son absence) et des boîtes de joueurs facultatives.
   `frame_id` doit correspondre à l'ordre de décodage. Voir
   [docs/schemas.md](schemas.md) pour le format.
   La v0.1 n'a pas de détecteur. Vous pouvez exécuter vous-même TrackNetV3
   (MIT) ou Ultralytics YOLO (AGPL-3.0) et convertir les résultats, mais aucun
   script de conversion n'est inclus. Aucun poids de modèle n'est téléchargé.
2. **Entrée de calibration** : pour chaque segment de caméra, marquez en pixels
   au moins quatre intersections de lignes du terrain (`fit`), quelques
   intersections pour la validation (`heldout`) et les sommets des deux
   poteaux du filet (hauteur 1,55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Vérifiez d'abord `heldout_summary` (l'erreur sur les points non utilisés
   pour l'ajustement) et `net_anchor_sensitivity` (de combien la hauteur varie
   quand les poteaux du filet sont décalés de l'erreur en pixels indiquée).
   L'homographie du sol n'est utilisée que pour les points au sol (Z=0) et
   jamais pour le volant en l'air.
3. **Annotations de revue (`review.json`)** : saisissez l'instant du contact
   raquette (`time_s`), l'intervalle de revue qui le contient
   (`time_bracket_s`), le pixel du contact et une estimation de hauteur.
   L'instant du contact est la seconde 0 du vol. Une première détection
   tardive ne change pas la seconde 0.
   Seul le dernier contact d'un segment peut avoir une condition de fin : un
   `landing_region` (la zone et l'intervalle de temps où le volant atteint le
   sol) ou `open` (jusqu'à la dernière observation du segment, ou jusqu'au
   `until_s` vérifié). Tout autre vol se termine au contact suivant et n'est
   pas forcé à atteindre le sol. La v0.1 ne corrige pas automatiquement les
   instants de contact, corrigez-les donc vous-même en regardant les images.
4. **Analyse et rendu**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Le commentaire `# 한 번에:` signifie « tout en une seule étape : » ; `run`
   effectue l'analyse et le rendu ensemble.

   L'outil s'arrête avec le code de sortie 2 si le PTS recule, si le même
   segment de caméra réapparaît après une interruption, si un contact se
   trouve hors de son segment de caméra ou de son intervalle de revue, ou si
   le PTS de la vidéo et celui des pistes diffèrent. Il ne corrige jamais
   l'entrée silencieusement.

## Lire les résultats

- Cercle vert : les coordonnées de détection d'entrée telles que fournies. Les
  images sans détection restent vides.
- Cercle/points orange : le modèle physique conditionnel. Dessiné uniquement
  au sein d'un même segment de caméra et d'un même vol.
- Cadre bleu en pointillés : la zone d'atterrissage indiquée par une personne.
  La marque × est le point d'atterrissage du modèle ajusté avec cette zone
  comme condition, pas une coordonnée mesurée.
- La vitesse est la vitesse initiale du modèle, arrondie à 5 km/h.
- Pour un vol renvoyé, le point « où il serait tombé s'il n'avait pas été
  renvoyé » est enregistré uniquement dans le JSON
  (`unreturned_floor_crossing_prediction`, une prédiction contrefactuelle).
- Si la source contient de l'audio, les paquets audio sont copiés tels quels
  sans réencodage, de sorte que le délai de début de l'audio et les trous de
  la source sont préservés. Si l'audio ne peut pas être copié dans un MP4 ou
  si son timing changerait, le rendu échoue. Le résultat du décodage complet
  du fichier de sortie pour vérification est écrit dans `render_report.json`.
- Les fichiers existants ne sont jamais écrasés. L'outil s'arrête si un
  fichier de sortie existe déjà ou s'il s'agit du même fichier que la vidéo
  source, et le rendu écrit dans un fichier temporaire qui n'est renommé avec
  le nom final qu'après vérification.

## Licence

GNU AGPL-3.0 uniquement. Voir [LICENSE](../LICENSE) et [NOTICE.md](../NOTICE.md).
