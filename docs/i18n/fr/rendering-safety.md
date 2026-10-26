# Rendu et sécurité des sorties

Le moteur de rendu produit un MP4 de replay : l'image source à gauche et une
vue du terrain de dessus à droite. Il a deux missions aussi importantes que le
dessin lui-même : préserver le minutage de la source, et ne jamais endommager
ni écraser un fichier. Tout ce qui est décrit sur cette page se trouve dans
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Décoder, dessiner, encoder

PyAV encapsule les bibliothèques FFmpeg dans le processus Python. Le moteur de
rendu ouvre la source, prend le premier flux vidéo et, s'il existe, le premier
flux audio, et démultiplexe leurs paquets dans l'ordre du fichier
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```{figure} assets/technical/fr/render-pipeline.svg
:alt: Pipeline de rendu : source.mp4 est démultiplexé ; les paquets vidéo sont décodés en image k, vérifiés, dessinés et encodés dans staging.mp4 ; l'audio est copié
:class: technical-figure
:width: 100%

Chemin de chaque image, des paquets source au fichier intermédiaire.
```

Pour chaque image vidéo décodée `k`, avant de dessiner, il vérifie que :

- l'analyse possède bien une image `k`, et que son `frame_id` est égal à `k`,
- l'image décodée possède un PTS, et
- l'instant décodé diffère du `pts_s` de l'analyse d'au plus `1e-3` s.

Tout échec lève `RenderError` en nommant l'image. Après le dernier paquet, le
nombre d'images décodées doit être égal au nombre d'images de l'analyse.

L'encodage essaie `libx264`, puis `h264`, puis `mpeg4`, selon ce que la
compilation locale de FFmpeg peut ouvrir, avec le format de pixel `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
L'encodeur utilise le `time_base` de la vidéo source ; ce n'est que pour
`mpeg4` avec un dénominateur de `time_base` supérieur à 65535 qu'il se replie
sur 1/60000 s. Chaque image de sortie reçoit l'instant de l'image source
converti dans ce `time_base`, si bien qu'une fréquence d'images variable reste
variable. Le `rate=30` passé à la création du flux est une valeur nominale ;
les instants des images viennent de la source.

Les horodatages de la vidéo de sortie sont arrondis aux ticks de l'encodeur.
La vérification contrôle le nombre d'images de sortie, mais ne compare pas
chaque PTS vidéo de sortie décodé avec la source. La vérification audio
compare les instants de présentation des paquets et le premier décalage A/V
décodé
([code source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Mise en page

```{figure} assets/technical/fr/render-layout.svg
:alt: Disposition 6:4 : à gauche l'image source non mise à l'échelle (W x H) ; à droite la vue de dessus, terrain ajusté à 4/6 W
:class: technical-figure
:width: 100%

Image de sortie : panneau source et vue de dessus en rapport de largeur 6:4.
```

`W` et `H` sont la largeur et la hauteur de la source arrondies au nombre pair
supérieur (H.264 exige des dimensions paires) ; la largeur de la vue de dessus
vaut `2 * round(W * 4 / 6 / 2)`. L'image source est collée à l'échelle 1.0
dans le coin supérieur gauche ; l'arrondi supérieur ajoute au plus une ligne
ou une colonne de pixels noirs. La vue de dessus
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
met à l'échelle le terrain de 6.10 x 13.40 m pour qu'il tienne dans son
panneau avec une marge, en conservant ses proportions.

Pillow dessine les superpositions
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)) :

- anneau vert : votre détection (`shuttle_observed_px`) ;
- anneau orange : la projection du modèle (`shuttle_model_px`) ;
- boîtes des joueurs, si vos pistes en contiennent ;
- vue de dessus : lignes du terrain, filet, traînée du modèle pour le vol en
  cours, un point dont la taille croît avec la hauteur du modèle, `z` et la
  vitesse arrondie du modèle ;
- vols avec atterrissage : la zone vérifiée sous forme de rectangle en
  pointillés et, à partir de l'instant d'atterrissage, une croix orange au
  point d'atterrissage du modèle.

Les images de changement de plan affichent « camera cut: excluded from
replay » et aucune superposition du volant. Les entrées synthétiques ajoutent
`SYNTHETIC` au titre de la vue de dessus.

## Audio : copie du flux, pas de réencodage

L'audio n'est ni décodé ni réencodé. Chaque paquet audio est copié dans le
nouveau conteneur avec ses horodatages d'origine (`add_stream_from_template`,
puis `mux`). Les paquets sans DTS sont ignorés. Cela conserve le décalage de
début de l'audio de la source et ses éventuels trous, ce qui compte parce que
dans les fichiers réels l'audio commence souvent une fraction de seconde après
la vidéo.

La copie du flux ne fonctionne que si le MP4 accepte le codec audio de la
source. Si le flux ne peut pas être créé ou si un paquet ne peut pas être
multiplexé, le rendu échoue avec une `RenderError` décrivant l'échec de la
copie du flux ; les erreurs de création du flux incluent le codec. Il n'y a
pas de repli vers le réencodage, donc tous les formats audio ne sont pas pris
en charge. Une source sans audio produit un MP4 muet, signalé par
`"source has no audio stream; output is silent"`.

## Vérification avant publication

Le moteur de rendu écrit dans un fichier intermédiaire et le contrôle avant
que quoi que ce soit n'apparaisse à votre chemin de sortie :

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   décode entièrement le fichier intermédiaire ; le nombre d'images vidéo
   décodées doit être égal au nombre d'images de l'analyse.
2. Avec de l'audio, le premier instant audio moins le premier instant vidéo
   doit correspondre à la source à `1e-3` s près
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. La liste des instants des paquets audio doit être identique à celle de la
   source
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

Le rapport de rendu enregistre ces résultats : `pts_check.max_abs_diff_s`,
`audio.av_offset_error_s`, `audio.packets_copied` et les compteurs
`verification`.

## Sortie sans écrasement

Avant tout travail,
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
refuse une source manquante, une sortie qui se résout vers la source (y
compris un lien symbolique ou un lien physique vers elle), et tout chemin de
sortie qui existe déjà, même un lien symbolique pendant. Rien n'est jamais
écrasé.

Le fichier intermédiaire est créé par `tempfile.mkstemp` dans le répertoire de
sortie avec un nom unique de la forme `.<stem>.<random>.staging.mp4`. Après la
vérification, `os.link` crée la sortie comme lien physique vers ce fichier. Un
lien physique échoue si le nom cible existe, si bien que la publication ne
peut pas remplacer un fichier apparu pendant le rendu. Le nom intermédiaire est
supprimé dans un bloc `finally` en cas de succès comme d'échec, si bien qu'un
fichier sans rapport dans le répertoire n'est jamais touché. Cela suppose que
le système de fichiers du répertoire de sortie prenne en charge les liens
physiques.

La CLI applique la même règle au JSON : `_refuse_existing` contrôle chaque
chemin de sortie dès le départ, et `_dump` ouvre les fichiers en mode de
création exclusive
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` publie la vidéo avant d'écrire les deux fichiers JSON ; les trois
sorties ne forment donc pas une transaction atomique. Il contrôle d'abord les
trois sorties, si bien qu'une entrée fournie qui se trouverait à
`<out-dir>/analysis.json` est refusée plutôt qu'écrasée. Les noms de fichiers
n'atteignent jamais un shell ; le test
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` effectue un
rendu à partir d'un nom contenant des métacaractères du shell.

Voir aussi : [Observations et temps](observations-timing.md) pour `pts_s`,
[Validation et limites](validation-limits.md) pour ce que prouvent les
contrôles média, [les schémas](schemas.md) pour le rapport de rendu.
