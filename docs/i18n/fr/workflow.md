# Flux de travail

## Ce que vous fournissez

- **Détections** (`tracks.json`) : une entrée par image décodée avec le PTS,
  l'id du segment de caméra, le pixel du volant ou null et des boîtes de
  joueurs facultatives. Il n'y a pas de détecteur intégré. Voir [](schemas.md).
- **Entrée de calibration** : par segment, au moins 4 points du terrain `fit`,
  quelques points `heldout` et les sommets des deux poteaux du filet (1,55 m).
- **Revue** (`review.json`) : les instants de contact, pixels et hauteurs que
  vous avez vérifiés, plus des zones d'atterrissage facultatives. Les contacts
  ne sont pas trouvés automatiquement.

N'importe quel tracker peut produire les détections ; par exemple, vous pouvez
exécuter vous-même TrackNetV3 (MIT) pour le volant et un modèle Ultralytics
YOLO (AGPL-3.0) pour les joueurs, avec vos propres checkpoints, puis convertir
leurs sorties. Les scripts de conversion ne font pas partie de la v0.1.

## Étapes

1. **Calibrer.** Pour chaque segment de caméra, mesurez ≥ 4 intersections de
   lignes du terrain (rôle `fit`), quelques autres en `heldout`, et les
   sommets des deux poteaux du filet.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Vérifiez `heldout_summary` et `net_anchor_sensitivity` avant d'aller plus
   loin.
2. **Réviser.** Écrivez `review.json` : instants de contact dans des
   intervalles vérifiés, a priori sur le pixel et la hauteur du contact, et
   pour le dernier vol d'un segment une zone d'atterrissage facultative ou
   `open`.
3. **Analyser et rendre.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Les entrées incohérentes (PTS non monotone, segments non contigus, contacts
   hors de leur segment ou intervalle, PTS ne correspondant pas à la vidéo, …)
   s'arrêtent avec le code de sortie 2 et un message ; rien n'est réparé
   silencieusement.

## Ce que fait chaque commande

- **`calibrate`** : homographie à partir de ≥ 4 points du sol vérifiés, plus
  la colonne verticale de la caméra à partir de ≥ 2 ancres surélevées du
  filet. Les points du sol réservés ne servent jamais à l'ajustement et sont
  rapportés séparément. Les entrées dégénérées, dupliquées, colinéaires et
  non finies sont rejetées. L'homographie du sol n'est jamais utilisée pour
  les points en l'air.
- **`analyze`** : un vol par contact vérifié, chronométré à partir du contact
  vérifié. Les changements de plan sont exclus et les vols ne franchissent
  jamais les segments. Chaque vol se termine au contact suivant, dans une zone
  d'atterrissage vérifiée (une contrainte, pas une coordonnée mesurée), ou à
  la dernière observation du segment. Les contrôles du sol et du filet
  rejettent les ajustements impossibles. Les détections manquantes restent
  null.
- **`render`** : vérifie chaque image source décodée par rapport au PTS des
  pistes et dessine les boîtes de joueurs fournies, les anneaux du volant
  observé (verts), les anneaux du modèle (orange) et une vue de dessus du
  terrain dans une disposition 6:4. L'audio source est copié en flux sans
  réencodage. Les sorties existantes ne sont jamais écrasées.
- **`demo`** : génère un échange synthétique et exécute tout le pipeline.

## Lire la sortie

| Couche | Signification |
| --- | --- |
| `observed_pixel` | détection fournie, inchangée ; null en cas d'absence |
| `human_review` | vos contacts, zones d'atterrissage et points de calibration |
| `conditional_model` | modèle physique ajusté aux pixels observés selon vos a priori |
| `display_interpolation` | lignes et marqueurs dessinés uniquement par le moteur de rendu |

Les vitesses sont la vitesse initiale du modèle ajusté (`model_speed_km_h`,
affichée arrondie à 5 km/h). Considérez-les comme des valeurs approximatives
du modèle, pas comme des mesures.

## Limites

- Aucune détection du volant ou des joueurs et aucun poids inclus.
- Aucune recherche automatique des contacts ni affinement des horodatages de contact.
- Aucune carte de profondeur dense apprise, aucune étiquette de coup apprise, aucune décision IN/OUT automatique.
- La sortie 3D est conditionnelle, pas mesurée. Les résultats de reconstruction synthétique sont synthétiques.
