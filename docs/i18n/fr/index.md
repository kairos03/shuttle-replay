# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**Transformez une vidéo locale de badminton, vos détections et votre revue en
un replay avec le terrain côte à côte. Hors ligne.**

`shuttle-replay` calibre une caméra à partir de points du terrain que vous
avez vérifiés, ajuste des trajectoires avec gravité et traînée quadratique aux
détections 2D du volant que vous fournissez, et produit un MP4 montrant la
vidéo source à côté d'une vue de dessus du terrain.

C'est un outil de recherche et de revue, pas un système d'arbitrage des
lignes, un classificateur de coups, un détecteur de volant ni un radar de
vitesse 3D mesurée :

- **Vous fournissez les détections.** Aucun détecteur de volant ou de joueurs
  n'est inclus et aucun poids de modèle n'est téléchargé.
- **Vous fournissez la revue.** Les contacts, zones d'atterrissage et points
  de calibration sont vérifiés par une personne ; rien n'est trouvé ni réparé
  automatiquement.
- **La 3D est conditionnelle, pas mesurée.** Chaque position et vitesse 3D est
  une sortie d'un modèle physique qui dépend de votre calibration et de vos
  annotations. Il n'y a pas de profondeur apprise, et une faible erreur de
  reprojection ne prouve pas l'exactitude 3D.

```{image} assets/demo.gif
:alt: Replay de démonstration synthétique, vue source à côté de la vue de dessus du terrain
:width: 90%
```

*Démonstration synthétique générée par `shuttle-replay demo`. Ce n'est pas une
mesure de l'exactitude en conditions réelles.*

```{toctree}
:maxdepth: 2
:caption: Guide

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: Explications techniques

technology
camera-calibration
trajectory-physics
observations-timing
rendering-safety
validation-limits
```

```{toctree}
:maxdepth: 1
:caption: Langues

languages
```

```{toctree}
:maxdepth: 1
:caption: Projet

development
license
```
