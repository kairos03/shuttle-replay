# Formats d'entrée et de sortie (v0.1)

Toutes les coordonnées en mètres utilisent le repère du terrain : X en travers
du terrain et Y dans sa longueur, la limite extérieure du terrain (bords
extérieurs des lignes de limite) étant à X = 0 .. 6.10 et Y = 0 (fond) ..
13.40 (proche) ; Z vers le haut (0 = sol). Le plan du filet est Y = 6.70. Les
lignes font 40 mm de large ; saisissez les points au sol au centre des
lignes : lignes extérieures X = 0.02 / 6.08 et Y = 0.02 / 13.38, lignes de
côté du simple X = 0.48 / 5.62, lignes de service court Y = 4.70 / 8.70,
lignes de service long du double Y = 0.78 / 12.62, ligne centrale X = 3.05.
Les coordonnées d'image sont des pixels de la vidéo source (x vers la droite,
y vers le bas). Les temps sont les horodatages de présentation (PTS) de la
source en secondes, tels que décodés par FFmpeg/PyAV
(`frame.pts * time_base`), jamais `frame_index / fps`.

Exécutez `shuttle-replay demo --out-dir demo` pour obtenir dans
`demo/inputs/` un exemple synthétique complet de chacun des fichiers
ci-dessous.

## Entrée de calibration — `shuttle-replay/calibration-input/v1`

```json
{
  "schema": "shuttle-replay/calibration-input/v1",
  "segments": [
    {
      "segment_id": 0,
      "image_size": [1280, 720],
      "ground_points": [
        {"name": "far_left_corner", "world_m": [0.02, 0.02], "image_px": [412.0, 188.5], "role": "fit"},
        {"name": "single_left_x_short_far", "world_m": [0.48, 4.70], "image_px": [430.1, 260.2], "role": "heldout"}
      ],
      "net_anchors": [
        {"name": "left_post_top", "world_m": [0.0, 6.7, 1.55], "image_px": [380.2, 250.0], "uncertainty_px": 3.0}
      ]
    }
  ]
}
```

- Les points `role: "fit"` (≥ 4, non colinéaires, non dupliqués) estiment
  l'homographie du sol. Les points `role: "heldout"` (≥ 1) ne sont jamais
  ajustés et sont rapportés séparément comme erreurs de validation en pixels
  et en mètres.
- `net_anchors` (≥ 2, Z > 0,1 m) reconstituent la colonne verticale de la
  matrice de caméra. Avec exactement deux ancres, la colonne est déterminée
  presque exactement, donc leur résidu en dit peu ; la sortie inclut un
  rapport de sensibilité (décalage vertical d'un point situé 3 m au-dessus du
  filet quand une ancre bouge de `uncertainty_px`).
- Les nombres non finis, les points d'ajustement colinéaires/dupliqués, les
  ancres au niveau du sol et les caméras sous le sol sont rejetés.

La sortie (`shuttle-replay/calibration/v1`) contient par segment `P` (3×4,
mètres → pixels), `H_world_to_image` / `H_image_to_world` (sol uniquement),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` et une copie des entrées.

## Pistes — `shuttle-replay/tracks/v1`

```json
{
  "schema": "shuttle-replay/tracks/v1",
  "source_video": "match.mp4",
  "frames": [
    {"frame_id": 0, "pts_s": 0.0, "segment_id": 0,
     "shuttle": {"u": 315.3, "v": 265.6, "score": 0.91},
     "players": [{"label": "near", "box": [339.8, 350.1, 408.4, 521.7], "score": 0.9}]},
    {"frame_id": 1, "pts_s": 0.0333, "segment_id": 0, "shuttle": null, "players": []}
  ]
}
```

- Une entrée par image source décodée, dans l'ordre de décodage ; `frame_id`
  doit être égal à l'indice de décodage (le moteur de rendu vérifie cela ainsi
  que le PTS de chaque image).
- `frame_id` et `pts_s` doivent être strictement croissants et finis.
- `segment_id` identifie un plan de caméra continu qui possède une
  calibration ; `null` marque les changements de plan / gros plans / ralentis,
  qui sont exclus. Un segment doit être contigu ; un id de segment qui
  réapparaît après un autre segment est rejeté (donnez au plan ultérieur son
  propre id et sa propre calibration).
- `shuttle: null` signifie « aucune détection ». Il reste null dans toutes les
  sorties.

## Annotations de revue — `shuttle-replay/review/v1`

```json
{
  "schema": "shuttle-replay/review/v1",
  "physics": {"pixel_sigma_px": 3.0, "contact_guard_s": 0.02},
  "contacts": [
    {"id": "c1", "segment_id": 0, "time_s": 0.20, "time_bracket_s": [0.16, 0.24],
     "image_px": [402.0, 300.0], "height_m": 1.05, "height_sigma_m": 0.3,
     "review": "racket contact visible"}
  ],
  "flight_ends": [
    {"contact_id": "c5", "type": "landing_region", "time_bracket_s": [5.1, 5.4],
     "region_xy_m": {"min": [4.2, 0.8], "max": [4.9, 1.6]}, "review": "lands IN"},
    {"contact_id": "c3", "type": "open", "review": "camera cuts away mid-flight"}
  ]
}
```

- Les contacts sont des contacts raquette vérifiés. `time_s` est l'horodatage
  vérifié du contact et devient le temps zéro du vol, même lorsque la première
  détection du volant arrive plus tard. Il doit se trouver dans son segment de
  caméra et dans `time_bracket_s` (largeur ≤ 0,5 s). Les contacts d'un segment
  doivent être strictement croissants. La v0.1 n'affine pas automatiquement
  les instants de contact ; affinez-les en examinant les images et en
  modifiant `time_s`.
- A priori de position : `image_px` (pixel de contact vérifié, intersecté avec
  le plan Z = `height_m` via la matrice de caméra complète P) ou `court_xy_m`.
  `height_m` est un a priori vérifié avec `height_sigma_m` ; `xy_sigma_m` est
  facultatif (0,5 m par défaut).
- Un vol va d'un contact au contact suivant du même segment
  (`intercepted_by_next_contact`, jamais forcé vers le sol). Seul le dernier
  contact d'un segment peut avoir une entrée `flight_ends` : `landing_region`
  (contact avec le sol contraint dans le cadre vérifié pendant l'intervalle de
  temps) ou `open` (ajustement jusqu'à la dernière observation du segment, ou
  jusqu'à un `until_s` vérifié facultatif). Entrée absente = open.
- Clés de `physics` (toutes facultatives) : `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Sortie d'analyse — `shuttle-replay/analysis/v1`

- `flights[]` : `t0_s` (contact vérifié), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` au contact), `fit` (RMS / p90 / max de
  reprojection en px, nombre d'observations, statut de l'optimiseur), `gates`
  (faisabilité vis-à-vis du sol et du filet ; hauteur au filet ≥ 1,524 m
  lorsque le vol franchit le filet), `parameters_at_bound` (un ajustement
  bloqué sur une borne de l'optimiseur est rejeté), `accepted`,
  `model_speed_km_h` et `model_speed_coarse_km_h`,
  `first_observation_delay_s`, `observation_frame_ids`, `landing` (vols avec
  atterrissage ; `exact_coordinate_measured: false`) et
  `unreturned_floor_crossing_prediction` (vols interceptés/ouverts ;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]` : `shuttle_observed_px` (détection fournie ou null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (modèle accepté uniquement, même
  segment), `model_flight_id`, `layer` (`conditional_model`, `observed_pixel`,
  `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Rapport de rendu

`render_report.json` enregistre l'encodeur, le nombre d'images, l'écart
maximal entre le PTS source décodé et le PTS des pistes, la disposition 6:4,
si l'audio a été préservé, ainsi qu'un décodage complet du MP4 écrit.
