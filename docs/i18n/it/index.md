# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**Trasforma un video locale di badminton, le tue rilevazioni e la tua
revisione in un replay con il campo affiancato. Offline.**

`shuttle-replay` calibra una telecamera a partire da punti del campo che hai
revisionato, adatta traiettorie con gravità e resistenza quadratica alle
rilevazioni 2D del volano che fornisci tu, e produce un MP4 con il video
originale accanto a una vista dall'alto del campo.

È uno strumento di ricerca e revisione, non un sistema di giudizio delle
linee, un classificatore di colpi, un rilevatore di volano né un misuratore di
velocità 3D:

- **Le rilevazioni le fornisci tu.** Non è incluso alcun rilevatore di volano
  o di giocatori e non viene scaricato alcun peso di modello.
- **La revisione la fornisci tu.** Contatti, zone di atterraggio e punti di
  calibrazione sono revisionati da una persona; nulla viene trovato o
  corretto automaticamente.
- **Il 3D è condizionale, non misurato.** Ogni posizione e velocità 3D è un
  output di un modello fisico che dipende dalla tua calibrazione e dalle tue
  annotazioni. Non c'è profondità appresa, e un errore di riproiezione basso
  non dimostra l'accuratezza 3D.

```{image} assets/demo.gif
:alt: Replay dimostrativo sintetico, vista originale accanto alla vista dall'alto del campo
:width: 90%
```

*Dimostrazione sintetica generata da `shuttle-replay demo`. Non è una misura
dell'accuratezza nel mondo reale.*

```{toctree}
:maxdepth: 2
:caption: Guida

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: Spiegazioni tecniche

technology
camera-calibration
trajectory-physics
observations-timing
rendering-safety
validation-limits
```

```{toctree}
:maxdepth: 1
:caption: Lingue

languages
```

```{toctree}
:maxdepth: 1
:caption: Progetto

development
license
```
