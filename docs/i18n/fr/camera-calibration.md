# Étalonnage de la caméra

L'étalonnage répond à une seule question : pour un point du terrain, en
mètres, à quel pixel la caméra le montre-t-elle ? `shuttle-replay` y répond
avec un modèle linéaire de caméra sténopé estimé à partir de points que vous
avez localisés à la main. Cette page explique les systèmes de coordonnées, les
deux matrices que l'outil calcule, l'algorithme exact et la signification des
erreurs rapportées.

## Deux systèmes de coordonnées

Les **coordonnées image** `(u, v)` sont des pixels de la vidéo source : `u`
augmente vers la droite, `v` augmente vers le bas.

Les **coordonnées monde** `(X, Y, Z)` sont des mètres dans un repère du
terrain fixé par les dimensions de terrain de la BWF
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)) :

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

Les lignes font 40 mm de large et les points d'étalonnage utilisent les
**centres des lignes** : lignes extérieures à X = 0.02 / 6.08 et
Y = 0.02 / 13.38, lignes latérales de simple à X = 0.48 / 5.62, lignes de
service court à Y = 4.70 / 8.70, lignes de service long de double à
Y = 0.78 / 12.62, ligne centrale X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Saisir un bord extérieur là où un centre est attendu décale ce point de 2 cm.

## Projection sténopé

Une caméra sténopé envoie un point du monde vers un pixel avec une matrice
3x4 `P` :

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

La division par `c` est la perspective : les objets lointains paraissent
petits. `P` combine la position et l'orientation de la caméra (les paramètres
extrinsèques) avec sa focale et son centre d'image (les paramètres
intrinsèques). Le projet ne décompose jamais `P` en ces parties ; il utilise
`P` comme une seule matrice
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
Le centre de la caméra `C` est l'unique point tel que `P * [C, 1] = 0`, donc
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Étape 1 : l'homographie du sol (Z = 0 uniquement)

Pour les points au sol, `Z = 0`, donc la troisième colonne de `P` est
multipliée par zéro et disparaît :

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

La matrice 3x3 `H = [p1 p2 p4]` est une **homographie**. Elle est ajustée à
partir de vos points au sol `role: "fit"` par la transformation linéaire
directe (DLT) normalisée dans
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78) :

1. Chaque ensemble de points est translaté vers son centroïde et mis à
   l'échelle de sorte que sa distance moyenne au centroïde soit `sqrt(2)`
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   Cela garde le système linéaire bien conditionné lorsque les valeurs en
   pixels se comptent en centaines et les mètres en unités.
2. Chaque correspondance ajoute deux lignes à un système linéaire `A h = 0`.
3. `h` est le vecteur singulier droit de `A` pour la plus petite valeur
   singulière ; la normalisation est annulée et `H` est mise à l'échelle de
   sorte que `H[2, 2] = 1`.

Les entrées dégénérées sont rejetées avec `CalibrationError` au lieu de
produire une mauvaise matrice : moins de quatre points d'ajustement,
coordonnées en double, ensembles de points colinéaires, trois points
colinéaires sur exactement quatre, une deuxième plus petite valeur singulière
inférieure à `1e-9` fois la plus grande (solution non unique), ou un
conditionnement supérieur à `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

L'ajustement est une DLT normalisée qui minimise un résidu algébrique sur tous
les points d'ajustement, sans raffinement non linéaire de la reprojection. Il
n'y a pas de rejet des valeurs aberrantes (pas de RANSAC) ni de modèle de
distorsion de l'objectif : un point mal saisi ou une forte distorsion en
barillet tire tout l'ajustement.

`H` ne décrit que le sol. La sortie l'indique dans `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Rétroprojeter un pixel du volant à travers `H` répond à « où serait ce pixel
s'il était au sol », ce qui est faux pour tout objet en l'air.

## Étape 2 : la colonne verticale à partir des ancres du filet

Les points au sol ne disent rien de `p3`, la colonne qui multiplie la hauteur.
Il faut pour cela des points de hauteur connue qui ne sont pas au sol :
normalement les sommets des deux poteaux du filet à `Z = 1.55`. Pour une ancre
en `(X, Y, Z)` vue en `(u, v)`, on écrit `q = H * [X, Y, 1]`. La condition de
projection devient linéaire en `p3` :

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
empile ces lignes, exige un rang 3, résout par moindres carrés et assemble
`P = [h1 h2 p3 h3]`, où `h1`, `h2`, `h3` sont les colonnes de `H`. Trois
inconnues et deux lignes par ancre signifient que deux ancres donnent quatre
équations : un système presque exactement déterminé. C'est pourquoi un faible
résidu des ancres (`net_anchor_residuals_px`) prouve peu de chose. Les ancres
doivent être surélevées (`Z > 0.1 m`) et il en faut au moins deux.

Enfin,
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
rejette une caméra dont le centre n'est pas au-dessus du sol, ou une caméra qui
placerait certains points du terrain devant elle et d'autres derrière.

## Points d'ajustement et points réservés

Chaque point au sol a un rôle
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)) :

- Les points `fit` construisent `H`. Leurs résidus (`fit_ground_residuals`)
  sont une erreur d'entraînement et sont censés être petits.
- Les points `heldout` ne servent jamais à l'ajustement. Au moins un est
  requis. `heldout_ground_errors` rapporte, pour chaque point, `error_px` (`H`
  appliquée au point monde, comparée à votre pixel) et `error_m` (l'inverse de
  `H` appliquée à votre pixel, comparée au point monde). `heldout_summary`
  donne le nombre, la moyenne et le maximum des deux.

Un exemple conceptuel : les quatre coins extérieurs comme `fit` et deux
intersections de lignes de service comme `heldout`. Si les erreurs des points
réservés sont bien plus grandes que les résidus d'ajustement, un point est mal
étiqueté, on a cliqué sur le bord d'une ligne au lieu de son centre, ou
l'objectif courbe les lignes. L'erreur des points réservés ne contrôle que la
correspondance du sol ; elle ne dit rien des hauteurs.

## Sensibilité, pas intervalle de confiance

Les hauteurs dépendent presque entièrement des ancres.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
prend un point de référence `(3.05, 6.70, 3.0)`, 3 m au-dessus de la ligne
centrale du filet, et le projette avec `P`. Puis, pour chaque ancre et pour
`u` et `v` séparément, il déplace le pixel de l'ancre de `+uncertainty_px` et
de `-uncertainty_px` (3.0 par défaut), résout à nouveau `P`, et intersecte le
rayon passant par le même pixel de référence avec le plan du filet `Y = 6.70`.
`max_vertical_shift_m` est la plus grande variation de hauteur. Si une
perturbation fait échouer la résolution, le décalage est rapporté comme
infini.

Il s'agit d'un pire cas, un paramètre à la fois, pour un seul point. Ce n'est
pas un intervalle de confiance statistique : il ne combine pas les erreurs de
plusieurs ancres et n'inclut pas l'erreur des points au sol.

## Hypothèses que vous faites

- Une caméra fixe par `segment_id` ; un déplacement de caméra ou un zoom exige
  un nouveau segment.
- Les lignes droites restent droites dans l'image (pas de distorsion de
  l'objectif).
- Les ancres ont les hauteurs que vous saisissez. Les sommets des poteaux à
  1.55 m et le centre du filet à 1.524 m sont des hauteurs différentes.
- Le plan du sol n'est pas le volant. `H` donne des positions au sol ; la
  profondeur du volant ne provient que de l'ajustement physique décrit dans
  [Physique de la trajectoire](trajectory-physics.md).

Voir [les schémas](schemas.md) pour l'ensemble des champs d'entrée et de
sortie, et [Validation et limites](validation-limits.md) pour lire les erreurs
conjointement avec les diagnostics de vol.
