# Validation et limites

`shuttle-replay` rapporte de nombreux nombres sur ses propres résultats.
Chacun répond à une question précise. Cette page indique, pour chaque
contrôle, ce qu'il montre, ce qu'il ne montre pas et quel test du dépôt
l'exerce. Aucun chiffre de précision ou de vitesse sur des séquences réelles
n'est donné ici, car le projet n'en a mesuré aucun.

## Ce que prouve chaque contrôle

**Erreur des points au sol réservés** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Prouve : l'homographie du sol prédit des points du terrain sur lesquels elle
n'a pas été ajustée. Ne prouve pas : quoi que ce soit sur les hauteurs, les
ancres du filet ou le volant.

**Résidus et sensibilité des ancres du filet** (`net_anchor_residuals_px`,
`net_anchor_sensitivity`). Avec deux ancres, la colonne verticale est presque
exactement déterminée, si bien que le résidu est proche de zéro presque par
construction. La valeur de sensibilité montre de combien se déplace un point
de référence situé 3 m au-dessus du filet lorsqu'une coordonnée d'ancre bouge
de son incertitude en pixels déclarée. C'est un scénario « et si », pas un
intervalle de confiance. Voir [Étalonnage de la caméra](camera-calibration.md).

**Erreur de reprojection** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Prouve : la projection du modèle passe près de vos
détections 2D. Ne prouve pas : que le chemin 3D est juste. Une autre
profondeur avec une autre vitesse peut se projeter sur presque les mêmes
pixels ; c'est la sous-détermination décrite dans
[Physique de la trajectoire](trajectory-physics.md). La limite d'acceptation
par défaut est de 8.0 px RMS.

**Contrôles du sol et du filet** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Les réussir montre que les 201 hauteurs échantillonnées valent au moins
−0.02 m, que chaque franchissement détecté, interpolé entre échantillons
adjacents, est à au moins 1.524 m, et qu'un franchissement a lieu lorsqu'il
est requis. Ces contrôles n'établissent ni une plausibilité physique générale
ni une précision dans le monde réel.

**`parameters_at_bound` et `optimizer_success`**. Un ajustement non convergé
est rejeté. Les sept paramètres d'état et de traînée sont signalés lorsque
leur distance à une borne est inférieure à 0.1 % de leur plage autorisée. Un
ajustement signalé est rejeté. Le temps d'atterrissage n'est pas inclus dans ce
diagnostic. Réussir ce contrôle n'établit ni l'identifiabilité, ni l'unicité,
ni l'absence d'influence des a priori.

**Contrôles média** (rapport de rendu). Prouvent : chaque image source a été
appariée par indice et par PTS, la sortie se décode avec le bon nombre
d'images, et les paquets audio ont conservé leurs instants. Ne prouvent pas :
que votre `pts_s` provient du même fichier que celui sur lequel les détections
ont été faites, au-delà de la correspondance des PTS elle-même.

**Récupération synthétique** (`demo`, `synthetic_recovery.json`).
`synthetic_recovery.json` rapporte des comparaisons avec la vérité terrain
synthétique. Les tests vérifient des tolérances de récupération choisies pour
des cas synthétiques précis ; la seule génération du rapport n'impose pas ces
tolérances. Ni l'un ni l'autre ne montre la précision sur une vidéo réelle. Le
`label` du fichier le dit : "SYNTHETIC ground-truth recovery; not evidence of
accuracy on real video".

## Là où l'incertitude est qualitative

L'ajustement possède des sigmas, mais la sortie ne les transforme pas en
barres d'erreur. Il n'y a ni covariance, ni bootstrap, ni intervalle de
confiance sur la position, la vitesse ou le point d'atterrissage.
L'incertitude est exprimée à la place par des étiquettes : `conditional_model`,
`exact_coordinate_measured: false`, `speed_scope` et la liste `assumptions`
présente dans chaque fichier d'analyse
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
L'arrondi de la vitesse à 5 km/h est un choix d'affichage, pas une estimation
d'erreur.

## Pourquoi ce n'est pas autre chose

- **Pas de 3D mesurée.** Une caméra donne des rayons, pas des points. La
  profondeur vient du modèle physique et de vos contacts vérifiés.
- **Pas de profondeur dense.** Il n'y a pas de carte de profondeur par pixel
  ni de réseau de profondeur appris. Seul le volant, le long des vols ajustés,
  reçoit une position 3D.
- **Pas d'IN/OUT automatique.** `landing.inside_court` compare un point du
  modèle à la limite extérieure du terrain. Le point est attiré de manière
  souple vers la zone que vous avez tracée, si bien que la réponse reflète
  surtout votre vérification ; l'appartenance à la zone n'est pas une exigence
  d'acceptation stricte (`landing.within_region` la rapporte avec une
  tolérance de 1 mm). Il n'y a pas de logique d'arbitrage des lignes, pas de
  règle simple/double et aucune mesure de l'endroit où le volant a touché.

## Ordre de débogage

Quand un vol paraît faux, lisez le pipeline de bas en haut :

1. **Étalonnage.** Des erreurs `heldout_summary` élevées ou un
   `max_vertical_shift_m` élevé : corrigez d'abord les points ou les ancres.
   Rien en aval ne peut rattraper cela.
2. **Entrées.** `observation_frame_ids` et `first_observation_delay_s` : la
   fenêtre contient-elle les détections attendues ?
3. **Statut.** `insufficient_observations` signifie trop peu de détections ;
   `rejected_by_gates_or_fit` signifie qu'il faut examiner les deux points
   suivants.
4. **Ajustement.** `optimizer_success`, `parameters_at_bound`, RMS et maximum
   de reprojection. Un maximum énorme avec un RMS faible désigne une seule
   mauvaise détection.
5. **Contrôles.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. Un contrôle du filet en
   échec signifie souvent un contact du mauvais côté ou une mauvaise hauteur de
   contact.
6. **Rapport de rendu.** Une non-correspondance des PTS ou des erreurs de
   nombre d'images signifient que les pistes n'appartiennent pas à ce décodage
   vidéo précis.

## Carte des preuves

| Affirmation | Test |
| --- | --- |
| Points réservés rapportés séparément ; `H` étiquetée Z=0 uniquement | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Mauvaises entrées d'étalonnage rejetées | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Pistes ou vérification incohérentes rejetées, non réparées | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| Le contact, et non la première détection, est le temps zéro | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| Les vols restent dans un seul segment | `test_flights_never_bridge_camera_segments` |
| Les détections manquantes restent null | `test_missing_detection_provenance_is_null_not_filled` |
| L'atterrissage est une contrainte, pas une mesure | `test_landing_region_is_a_constraint_not_a_measurement` |
| Les vols interceptés ne sont pas forcés d'atterrir | `test_intercepted_flight_is_not_forced_to_land` |
| Contrôles du filet et du sol | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| Ajustements bloqués sur une borne rejetés ; fenêtre `until_s` | `test_open_flight_window_and_bound_pinned_fits` |
| Centres des lignes du terrain | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| Contrôles des PTS et du nombre d'images ; noms de fichiers hostiles | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Les traînées restent dans un seul vol | `test_trails_stay_inside_one_flight_and_segment` |
| Aucun écrasement de la source ni des fichiers existants | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Décalage et trous audio préservés | `test_audio_is_stream_copied_with_source_relative_offset` |
| Artefacts de la démo de bout en bout | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

Tous les tests se trouvent dans
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
La plupart des tests de vol s'exécutent sur la scène synthétique de
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py) ;
ils confirment donc le comportement et les contrats, pas la précision dans le
monde réel. Non couverts par les tests : la distorsion de l'objectif, que
l'outil ne modélise pas, et les codecs audio autres que l'AAC utilisé dans les
tests.

Voir aussi : [le flux de travail](workflow.md) pour la liste des limites,
[le guide d'utilisation](guide.md) pour lire les résultats.
