# Observations et temps

Un ajustement de vol compare les positions du modèle aux détections **à des
instants précis**. Si ces instants sont faux, une trajectoire correcte paraît
fausse et une trajectoire fausse peut paraître correcte. Cette page explique
d'où viennent les instants, ce qu'exigent les contrats d'entrée, comment les
observations sont séparées de la vérification, et comment le temps est
échantillonné pour le modèle et pour le dessin.

## Le temps vient des PTS, pas du comptage d'images

Les conteneurs vidéo stockent pour chaque image un horodatage de présentation
(PTS) sous forme de nombre entier de ticks, avec un `time_base` qui indique la
durée d'un tick. L'instant de l'image en secondes est :

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

Beaucoup d'enregistrements de téléphone et d'écran ont une **fréquence
d'images variable** (VFR) : les durées des images diffèrent. Calculer
`frame_index / fps` dérive alors du temps réel. Le format des pistes stocke
donc `pts_s` pour chaque image, tel que décodé par FFmpeg/PyAV (voir
[les schémas](schemas.md)). La démo synthétique utilise délibérément la VFR :
avec un `time_base` de 1/30000 s, une image sur sept dure 1001 ticks au lieu
de 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

Le moteur de rendu compare ensuite chaque image décodée à votre `pts_s` ; voir
[Rendu et sécurité des sorties](rendering-safety.md).

## Contrats d'entrée

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
et
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
lèvent `InputError` à la première incohérence. Rien n'est réordonné,
dédoublonné ni réparé.

Pistes (`shuttle-replay/tracks/v1`) :

- `frame_id` est un entier strictement croissant ; `pts_s` est fini et
  strictement croissant.
- `segment_id` nomme un plan de caméra continu. `null` marque un changement de
  plan, un gros plan ou un ralenti. Un identifiant de segment qui réapparaît
  après un autre segment est rejeté ; chaque plan a donc besoin de son propre
  identifiant et de son propre étalonnage.
- `shuttle` vaut soit `null` (pas de détection), soit possède des `u` et `v`
  finis. Les boîtes des joueurs doivent être quatre nombres finis.

La plage temporelle de chaque segment est le PTS de sa première et de sa
dernière image. Chaque segment a besoin d'un étalonnage
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Vérification (`shuttle-replay/review/v1`) :

- Les identifiants de contact sont des chaînes uniques. Chaque contact se
  trouve dans la plage PTS de son segment et dans son propre
  `time_bracket_s`, dont la largeur est d'au plus 0.5 s.
- Les contacts d'un même segment sont strictement croissants dans le temps,
  dans l'ordre de la liste.
- `height_m` est dans l'intervalle ouvert (0, 4) m et `height_sigma_m` est
  positif. Chaque contact a besoin de `image_px` ou de `court_xy_m`.
- Seul le dernier contact d'un segment peut avoir une entrée `flight_ends`, de
  type `open` ou `landing_region`. Un intervalle d'atterrissage doit commencer
  après le contact ; le `min` de la zone doit être inférieur à son `max`. Le
  `until_s` d'une fin `open` doit suivre le contact et rester dans le segment.

## Observations et vérification

Deux types d'entrées jouent des rôles différents :

- **Observations** : vos détections. Elles entrent dans l'ajustement
  uniquement comme résidus en pixels et sont copiées sans modification dans
  `shuttle_observed_px`. Une image avec `shuttle: null` reste `null` dans
  toutes les sorties.
- **Contraintes vérifiées** : contacts, zones d'atterrissage, points
  d'étalonnage. Les positions et hauteurs de contact entrent comme a priori
  pondérés par des sigmas ; les points finaux d'atterrissage utilisent des
  échelles de pénalité fixes. Les points d'étalonnage déterminent la caméra au
  préalable. Les instants de contact sont fixes, et le temps d'atterrissage est
  ajusté dans son intervalle.

Lorsque le modèle remplit une image sans détection, la `layer` de cette image
est `conditional_model` tandis que `shuttle_observed_px` reste `null`. Le test
`test_missing_detection_provenance_is_null_not_filled` vérifie exactement
cela.

## Découpage en vols

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
regroupe les contacts par segment et transforme chaque contact en un vol. Un
vol ne traverse jamais un segment de caméra. Ses observations sont les images
du segment comportant une détection et telles que

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

La garde écarte les détections juste au moment du contact, où le volant est
souvent confondu avec la raquette. `observation_frame_ids` et
`observation_time_offsets_s` dans l'enregistrement de chaque vol montrent
exactement quelles images ont été utilisées, avec des décalages mesurés depuis
`t0`.

## Échantillonnage du modèle et affichage

Il existe trois échantillonnages différents, et seul le premier se fait par
image vidéo :

1. **Par image.** Pour chaque image comprise dans l'intervalle de temps d'un
   vol accepté, `shuttle_model_xyz_m` est le modèle évalué au PTS propre de
   cette image, et `shuttle_model_px` est sa projection par `P`
   ([boucle sur les images](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   Les images de changement de plan reçoivent `layer: "excluded_camera_cut"`,
   sans modèle ni joueurs, même si une détection brute existe
   (`raw_detection_ignored`).
2. **Dans l'ajustement.** 41 échantillons régulièrement espacés contrôlent les
   pénalités de sol et de filet ; 201 échantillons alimentent les contrôles
   d'acceptation. Voir [Physique de la trajectoire](trajectory-physics.md).
3. **Affichage.** La traînée de la vue de dessus est une polyligne passant par
   les échantillons du modèle par image antérieurs du **même** vol uniquement
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   Elle s'arrête à la première image ayant un `model_flight_id` différent ; une
   traînée ne relie donc jamais deux vols et n'enjambe jamais un changement de
   plan. Ces lignes sont de la `display_interpolation`, pas des données.

## Tolérances réellement contrôlées

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

Voir aussi : [les schémas](schemas.md) pour chaque champ,
[le flux de travail](workflow.md) pour produire des pistes avec votre propre
détecteur.
