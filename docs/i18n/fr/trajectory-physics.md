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

```{math}
\begin{aligned}
\frac{d\mathbf{r}}{dt} &= \mathbf{v} \\
\frac{d\mathbf{v}}{dt} &= -k \, \lVert \mathbf{v} \rVert \, \mathbf{v} - g \, \mathbf{e}_z
\end{aligned}
```

| Symbole | Signification |
|---|---|
| {math}`g` | gravité, 9,81 m/s² par défaut, réglée dans review (`"physics": "gravity_m_s2"`) |
| {math}`k` | coefficient de traînée par vol, unité 1/m |
| {math}`\lVert \mathbf{v} \rVert` | vitesse en m/s |
| {math}`\mathbf{e}_z` | vecteur unitaire vers le haut |

```{figure} assets/technical/fr/trajectory.svg
:alt: Exemple synthétique : hauteur en fonction de la distance horizontale depuis le départ, traînée k = 0,18 1/m et sans traînée k = 0
:class: technical-figure
:width: 100%

Exemple synthétique à partir de conditions initiales choisies, calculé avec simulate du paquet ; ce n'est ni une mesure, ni un vol ajusté, ni un banc d'essai.
```

```{figure} assets/technical/fr/speed.svg
:alt: Exemple synthétique : vitesse |v| en m/s en fonction du temps, k = 0,18 1/m et sans traînée k = 0
:class: technical-figure
:width: 100%

Vitesse du même exemple synthétique, issue de l'état de vitesse intégré ; la courbe sans traînée sert seulement de comparaison.
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

```{math}
\begin{aligned}
\rho_\mathrm{pixels} &= \frac{\operatorname{project}(P, \mathbf{r}(t_i)) - \mathbf{uv}_i}{\mathtt{pixel\_sigma\_px}} \\
\rho_\mathrm{start} &= \frac{\mathbf{r}(0) - \mathtt{contact\_prior}}{\mathtt{start\_sigma}} \\
\rho_\mathrm{drag} &= \frac{k - 0.18}{0.15} \\
\rho_\mathrm{intercept} &= \frac{\mathbf{r}(T) - \mathtt{next\_contact\_prior}}{\mathtt{next\_contact\_sigma}} \\
\mathbf{d}^{-} &= \max\!\left(\mathbf{b}_{\min}-\mathbf{r}_{xy}(T),\mathbf{0}\right) \\
\mathbf{d}^{+} &= \max\!\left(\mathbf{r}_{xy}(T)-\mathbf{b}_{\max},\mathbf{0}\right) \\
\mathbf{d}_\mathrm{out} &= \mathbf{d}^{-}+\mathbf{d}^{+} \\
\rho_\mathrm{landing} &= \left(\frac{z(T)}{0.01},\frac{d_{\mathrm{out},x}}{0.02},\frac{d_{\mathrm{out},y}}{0.02}\right) \\
\rho_\mathrm{floor} &= \frac{\min(z, 0)}{0.01} \\
\rho_\mathrm{net} &= \frac{\max(0,\ 1.55 - h_\mathrm{net})}{0.02}
\end{aligned}
```

| Terme | Échelle ou condition |
|---|---|
| {math}`\rho_\mathrm{pixels}` | 3,0 px par défaut |
| {math}`\rho_\mathrm{start}` | xy 0,5 m, hauteur 0,3 m |
| {math}`\rho_\mathrm{drag}` | toujours |
| {math}`\rho_\mathrm{intercept}` | interceptés seulement |
| {math}`\rho_\mathrm{landing}` | atterrissage uniquement ; trois composantes : hauteur et dépassement de la région sur chaque coordonnée. {math}`\mathbf{d}_\mathrm{out}` est un vecteur à deux composantes ; {math}`\mathbf{b}_{\min}` et {math}`\mathbf{b}_{\max}` sont les bornes de la région ; max est appliqué composante par composante |
| {math}`\rho_\mathrm{floor}` | sur 41 échantillons de 0 à {math}`T` |
| {math}`\rho_\mathrm{net}` | seulement si un passage est requis |

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

```{math}
\begin{aligned}
x &\in [-3,\ 9.1]\ \mathrm{m} \\
y &\in [-3,\ 16.4]\ \mathrm{m} \\
z &\in [0.05,\ 4.5]\ \mathrm{m} \\
v_x, v_y, v_z &\in [-v_{\max},\ +v_{\max}] \\
k &\in \mathtt{drag\_bounds\_per\_m}
\end{aligned}
```

Valeurs par défaut : {math}`v_{\max}` = `velocity_bound_m_s` 120 m/s ; `drag_bounds_per_m` [0.015, 0.6] 1/m. L'instant d'atterrissage {math}`T` est dans l'intervalle d'atterrissage revu (vols avec atterrissage seulement).

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
