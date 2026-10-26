# Vue d'ensemble de la technologie

`shuttle-replay` transforme trois types de données en un replay : une vidéo
source locale, des détections 2D du volant que vous fournissez, et des
contraintes vérifiées par une personne (points d'étalonnage, contacts et zones
d'atterrissage). Cette page sert de carte. Les cinq pages qui la suivent
expliquent chaque étape en détail, et chaque page renvoie aux lignes exactes
du code source qu'elle décrit, figées au commit
`6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Flux de données

```{figure} assets/technical/fr/pipeline.svg
:alt: Flux de données : calibration, pistes et revue alimentent analyze ; vidéo et analyse alimentent render, qui écrit le MP4 et un rapport
:class: technical-figure
:width: 100%

Entrées et sorties des trois commandes.
```

La CLI expose chaque flèche sous forme de commande : `calibrate`, `analyze`,
`render` et `run` (analyze + render en une seule étape). `demo` construit une
scène entièrement synthétique et y exécute le même pipeline
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
Dans `run`, la vidéo est rendue et vérifiée avant l'écriture de
`analysis.json` et `render_report.json`, si bien que les résultats JSON ne
décrivent jamais une vidéo dont la production a échoué
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

Ce qu'apporte chaque étape :

1. **L'étalonnage** transforme les positions en pixels, vérifiées, de points
   connus du terrain en une homographie du sol `H` et une matrice de caméra
   3x4 `P` par segment de caméra. Voir
   [Étalonnage de la caméra](camera-calibration.md).
2. **La validation des entrées** contrôle les horodatages, les segments, les
   contacts et les fins de vol, et rejette les incohérences au lieu de les
   réparer. Voir [Observations et temps](observations-timing.md).
3. **L'ajustement des vols** ajuste un modèle gravité + traînée quadratique
   aux détections 2D entre les contacts vérifiés. Voir
   [Physique de la trajectoire](trajectory-physics.md).
4. **Le rendu** décode la source, dessine les superpositions et une vue du
   terrain de dessus, copie les paquets audio et vérifie le résultat avant de
   le publier. Voir [Rendu et sécurité des sorties](rendering-safety.md).
5. **La validation** est répartie sur toutes les étapes. Ce que chaque
   contrôle prouve, et ce qu'il ne prouve pas, est rassemblé dans
   [Validation et limites](validation-limits.md).

## Pile logicielle

| Composant | Rôle dans ce projet |
| --- | --- |
| Python 3.12+ | Langage ; `requires-python = ">=3.12"` dans `pyproject.toml` |
| NumPy | Algèbre linéaire : DLT d'homographie, SVD, projection, résolution des ancres par moindres carrés |
| SciPy | `solve_ivp` intègre l'EDO du vol ; `least_squares` ajuste les vols |
| PyAV (`av`) | Liaisons FFmpeg dans le processus : décodage, encodage, copie du flux audio, vérification |
| Pillow | Dessine les anneaux, les traînées, le terrain et le texte sur chaque image |
| uv | Installe l'environnement verrouillé (`uv.lock`) et exécute les commandes |
| Sphinx + MyST + Furo | Construit ce site de documentation (le groupe de dépendances `docs`) |

Les dépendances d'exécution sont exactement `numpy`, `scipy`, `av` et `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
Aucun sous-processus ni aucune commande shell n'est construit à partir de noms
de fichiers ; le traitement vidéo passe par PyAV dans le même processus Python
([docstring du module `render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Pourquoi il n'y a pas de modèle intégré

Trouver un volant dans une image (détection) et décider où il se trouve en 3D
(reconstruction) sont deux problèmes distincts. Ce projet ne traite que le
second, et seulement sous des hypothèses explicites. Il n'y a ni détecteur, ni
réseau de neurones, ni poids de modèle à télécharger. Vous apportez des
détections issues de n'importe quel outil auquel vous faites confiance, au
format `shuttle-replay/tracks/v1` décrit dans [les schémas](schemas.md).

Ainsi, chaque nombre reste traçable. Chaque image d'analyse étiquette la
position du volant avec une couche de provenance
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)) :

- `observed_pixel` : votre détection, inchangée, ou null s'il n'y en avait pas.
- `human_review` : un contact, une zone d'atterrissage ou un point
  d'étalonnage saisi par une personne.
- `conditional_model` : le modèle physique ajusté, qui ne vaut que ce que
  valent l'étalonnage et la vérification dont il dépend.
- `display_interpolation` : les lignes que le moteur de rendu trace entre les
  échantillons du modèle.

Une détection manquante n'est jamais comblée comme si elle avait été observée,
et le modèle n'est jamais étiqueté comme une mesure.

## Parcours de lecture suggéré

Si vous débutez en vision par ordinateur, lisez dans cet ordre :

1. [Étalonnage de la caméra](camera-calibration.md) : comment les pixels se
   rapportent aux mètres, et pourquoi une caméra seule ne peut pas voir la
   profondeur.
2. [Physique de la trajectoire](trajectory-physics.md) : comment la physique et
   les contacts vérifiés comblent la profondeur manquante.
3. [Observations et temps](observations-timing.md) : pourquoi les horodatages
   viennent du conteneur vidéo et non d'un compteur d'images.
4. [Rendu et sécurité des sorties](rendering-safety.md) : comment le MP4 est
   construit et protégé.
5. [Validation et limites](validation-limits.md) : comment lire les
   diagnostics et où ils s'arrêtent.

Pour les étapes pratiques, voir [Prise en main](getting-started.md),
[le guide d'utilisation](guide.md) et [le flux de travail](workflow.md).
