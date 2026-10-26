# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**Transforme um vídeo local de badminton, suas detecções e sua revisão em um
replay com a quadra lado a lado. Offline.**

`shuttle-replay` calibra uma câmera a partir de pontos da quadra que você
revisou, ajusta trajetórias com gravidade e arrasto quadrático às detecções 2D
da peteca que você fornece, e gera um MP4 com o vídeo original ao lado de uma
vista superior da quadra.

É uma ferramenta de pesquisa e revisão, não um sistema de marcação de linhas,
um classificador de golpes, um detector de peteca nem um radar de velocidade
3D medida:

- **Você fornece as detecções.** Não há detector de peteca nem de jogadores
  incluído, e nenhum peso de modelo é baixado.
- **Você fornece a revisão.** Contatos, regiões de queda e pontos de
  calibração são revisados por uma pessoa; nada é encontrado ou corrigido
  automaticamente.
- **O 3D é condicional, não medido.** Cada posição e velocidade 3D é uma saída
  de um modelo físico que depende da sua calibração e das suas anotações. Não
  há profundidade aprendida, e um erro de reprojeção baixo não comprova a
  exatidão 3D.

```{image} assets/demo.gif
:alt: Replay de demonstração sintético, vista original ao lado da vista superior da quadra
:width: 90%
```

*Demonstração sintética gerada por `shuttle-replay demo`. Não é uma medida da
exatidão no mundo real.*

```{toctree}
:maxdepth: 2
:caption: Guia

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: Explicações técnicas

technology
camera-calibration
trajectory-physics
observations-timing
rendering-safety
validation-limits
```

```{toctree}
:maxdepth: 1
:caption: Idiomas

languages
```

```{toctree}
:maxdepth: 1
:caption: Projeto

development
license
```
