# Physique de la trajectoire

Une caméra voit un volant comme un pixel. Chaque point le long de la ligne de
visée passant par ce pixel, proche ou lointain, tombe sur le même pixel ; une
seule image ne peut donc pas indiquer la profondeur. Cette page explique
comment `shuttle-replay` transforme malgré tout une suite de pixels en vol 3D,
en ajoutant de la physique et des contraintes vérifiées, et ce que le résultat
signifie ou ne signifie pas.

## Le problème inverse

Considérez chaque détection comme un rayon issu de la caméra. Un vol est une
courbe qui doit passer près de chaque rayon au bon moment. Beaucoup de courbes
y parviennent : un vol lent et proche et un vol rapide et lointain peuvent
produire des pistes en pixels similaires. Le problème est sous-déterminé.
L'outil choisit une courbe en exigeant qu'elle :

- obéisse à la gravité et à la traînée de l'air (le modèle ci-dessous),
- commence près de la position et de la hauteur de contact vérifiées, à
  l'instant de contact vérifié,
- soit attirée de manière souple vers le contact vérifié suivant ou vers une
  zone d'atterrissage vérifiée, ou s'arrête à la fin de la fenêtre observée
  (les résidus de point final sont des pénalités, pas des exigences
  d'acceptation strictes), et
- reste au-dessus du sol et franchisse le filet lorsqu'elle doit le traverser.

Le chemin 3D ajusté est donc un **modèle conditionnel** : la courbe la plus
cohérente compte tenu de votre étalonnage et de votre vérification, pas une
mesure
([docstring du module `analysis.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## Le modèle de vol

L'état est la position `r = (x, y, z)` en mètres et la vitesse `v` en m/s.
Les équations du mouvement
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)) :

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

La traînée s'oppose au mouvement et croît avec le carré de la vitesse. Une
lecture utile de `k` : un volant qui tombe à la verticale cesse d'accélérer
lorsque la traînée égale la gravité, à la vitesse limite `sqrt(g / k)`. Avec
l'a priori par défaut `k = 0.18 1/m`, cela fait environ 7.4 m/s. Un volant
frappé à grande vitesse ralentit donc fortement ; le modèle n'a ni rotation, ni
basculement, ni vent.

Les sept paramètres ajustés sont `[x, y, z, vx, vy, vz, k]` au **temps de vol
zéro**, qui est l'instant de contact vérifié, et non l'instant de la première
détection
([docstring du module `physics.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
Les détections commencent souvent quelques images après le contact, parce que
la raquette ou un joueur masque le volant. Ces images sont mesurées comme des
décalages par rapport au contact, si bien qu'une première détection tardive ne
déplace pas le début du vol (`first_observation_delay_s` rapporte l'écart).

## Intégration numérique

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
intègre les équations avec SciPy `solve_ivp` (sa méthode explicite de
Runge-Kutta par défaut) depuis `t = 0`, avec `rtol=1e-7`, `atol=1e-8`,
`max_step=0.02` seconde et une sortie dense, puis évalue les positions aux
instants demandés. Les instants non finis et ceux inférieurs à `-1e-9` s sont
rejetés ; les minuscules valeurs négatives au-dessus de ce seuil sont ramenées
à zéro. Les tolérances du solveur contrôlent l'erreur d'intégration numérique ;
ce ne sont pas des bornes sur la précision de la reconstruction.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
utilise une fonction d'événement sur `z` (en descente uniquement, terminale)
avec des tolérances plus strictes (`rtol=1e-9`, `atol=1e-10`,
`max_step=0.01`) sur un horizon de 10 s.

## Ce qui est minimisé

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
construit un seul vecteur de résidus. Chaque entrée est une différence divisée
par une échelle, de sorte que « 1 » signifie « une erreur attendue » :

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` est la durée du vol. L'a priori de contact provient de
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54) :
si le contact a un `image_px`, le rayon passant par ce pixel est intersecté
avec le plan à la hauteur vérifiée `height_m` ; sinon, `court_xy_m` et
`height_m` sont utilisés directement. Les sigmas proviennent de `xy_sigma_m`
et `height_sigma_m` de chaque contact, avec repli sur les valeurs par défaut
indiquées.

Dans le terme du filet, `h_net` est la hauteur interpolée à laquelle le chemin
de 41 échantillons traverse pour la première fois `Y = 6.70` ; si le chemin ne
traverse jamais, `h_net` compte pour 0. Ce terme utilise 1.55 m (hauteur des
poteaux) tel qu'écrit dans le code source ; le contrôle d'acceptation
ci-dessous utilise 1.524 m (centre du filet).

SciPy `least_squares` minimise la somme avec `loss="soft_l1"` et
`f_scale=1.5`, si bien que quelques mauvaises détections tirent moins qu'avec
des carrés simples. Il part de six points de départ : `k` dans
`0.1, 0.2, 0.35` croisé avec une vitesse supplémentaire vers le haut de `1.0`
ou `3.0` m/s ajoutée à une estimation balistique vers la cible finale. Le
résultat de coût le plus faible l'emporte. Des bornes maintiennent la
recherche dans le domaine physique
([code source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)) :

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

Les sept paramètres d'état et de traînée sont signalés dans
`parameters_at_bound` lorsque leur distance à une borne est inférieure à 0.1 %
de leur plage autorisée
([code source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
Un ajustement signalé est rejeté. Le temps d'atterrissage n'est pas inclus dans
ce diagnostic. Réussir ce contrôle n'établit ni l'identifiabilité, ni
l'unicité, ni l'absence d'influence des a priori.

## Comment un vol se termine

Les vols sont construits par segment de caméra à partir des contacts dans
l'ordre chronologique
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)) :

- **`intercepted_by_next_contact`** : un autre contact suit dans le même
  segment. La durée est le temps entre les contacts ; la fin est attirée vers
  l'a priori du contact suivant. Un franchissement du filet est requis lorsque
  les a priori des deux contacts se trouvent de part et d'autre du filet.
- **`landing_region`** : le dernier contact d'un segment a une fin
  d'atterrissage vérifiée. Les résidus de contact et de point final
  d'atterrissage attirent de manière souple l'ajustement vers le point final
  vérifié. Le temps d'atterrissage est borné par l'intervalle vérifié, mais la
  hauteur du point final et l'appartenance à la zone ne sont pas des exigences
  d'acceptation strictes. `landing.within_region` rapporte l'appartenance avec
  une tolérance de 1 mm ; il ne contrôle pas l'acceptation. Un franchissement
  est requis lorsque le départ et le centre de la zone se trouvent de part et
  d'autre du filet.
- **`open_segment_end`** : tous les autres cas. La fenêtre se termine à la fin
  du segment ou à `until_s`, la durée d'ajustement est le décalage de la
  dernière observation, et aucun franchissement du filet n'est requis.

Moins de `min_observations` (4 par défaut) détections dans la fenêtre donne
`status: "insufficient_observations"` sans ajustement.

## Contrôles d'acceptation

Après l'ajustement, le chemin est échantillonné en 201 points et contrôlé par
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106) :
`floor_ok` exige que le point le plus bas soit à -0.02 m ou au-dessus.
`net_ok` exige un franchissement lorsqu'il était requis, et **chaque**
franchissement détecté entre échantillons adjacents doit être à 1.524 m ou
au-dessus, qu'un franchissement ait été attendu ou non. Un vol n'est accepté
que si l'optimiseur signale un succès, si les deux contrôles réussissent, si le
RMS de reprojection vaut au plus `max_accept_rms_px` (8.0 px par défaut) et si
aucun des sept paramètres d'état et de traînée n'est signalé. Les vols rejetés
conservent leurs paramètres pour inspection mais ne sont pas dessinés comme
couche du modèle.

## Vitesse et atterrissage contrefactuel

`model_speed_km_h` vaut `|v(0)| * 3.6`, la vitesse initiale du modèle, et
`model_speed_coarse_km_h` l'arrondit aux 5 km/h les plus proches pour
l'affichage. Ce n'est pas une mesure radar.

Pour les vols qui ne se terminent pas dans une zone d'atterrissage, si le
modèle atteignait le sol après la fin du vol, l'analyse ajoute
`unreturned_floor_crossing_prediction` avec
`kind: "counterfactual_if_unreturned"` et `observed: false`. Cela répond à
« où ce modèle atterrirait-il si personne ne l'avait renvoyé », et non à la
question de savoir où le volant est allé. Pour les vols avec atterrissage,
`landing.xy_m` est le point final du modèle attiré de manière souple vers
votre zone (sans garantie qu'il s'y trouve), et `exact_coordinate_measured`
vaut toujours `false`.

Voir aussi : [Étalonnage de la caméra](camera-calibration.md) pour `P`,
[Observations et temps](observations-timing.md) pour la fenêtre
d'observation, [Validation et limites](validation-limits.md) pour interpréter
`fit` et `gates`.
