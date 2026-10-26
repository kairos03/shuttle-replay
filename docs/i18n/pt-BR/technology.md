# Visão geral da tecnologia

`shuttle-replay` transforma três tipos de evidência em um replay: um vídeo
original local, detecções 2D da peteca que você fornece e restrições que uma
pessoa revisou (pontos de calibração, contatos e regiões de queda). Esta página
é o mapa. As cinco páginas seguintes explicam cada etapa em profundidade, e
cada página aponta para as linhas exatas do código-fonte que descreve, fixadas
no commit `6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Fluxo de dados

```{figure} assets/technical/pt-BR/pipeline.svg
:alt: Fluxo de dados: calibração, trilhas e revisão alimentam analyze; vídeo e análise alimentam render, que grava o MP4 e um relatório
:class: technical-figure
:width: 100%

Entradas e saídas dos três comandos.
```

A CLI expõe cada seta como um comando: `calibrate`, `analyze`, `render` e
`run` (analyze + render em um único passo). `demo` constrói uma cena
totalmente sintética e executa o mesmo pipeline sobre ela
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
Em `run`, o vídeo é renderizado e verificado antes de `analysis.json` e
`render_report.json` serem gravados, de modo que os resultados JSON nunca
descrevem um vídeo que falhou
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

O que cada etapa acrescenta:

1. **A calibração** transforma posições em pixels revisadas de pontos
   conhecidos da quadra em uma homografia do piso `H` e uma matriz de câmera
   3x4 `P` por segmento de câmera. Veja
   [Calibração da câmera](camera-calibration.md).
2. **A validação das entradas** verifica timestamps, segmentos, contatos e
   finais de voo, e rejeita inconsistências em vez de corrigi-las. Veja
   [Observações e tempo](observations-timing.md).
3. **O ajuste de voos** ajusta um modelo de gravidade + arrasto quadrático às
   detecções 2D entre contatos revisados. Veja
   [Física da trajetória](trajectory-physics.md).
4. **A renderização** decodifica o original, desenha sobreposições e uma vista
   superior da quadra, copia os pacotes de áudio e verifica o resultado antes
   de publicá-lo. Veja
   [Renderização e segurança da saída](rendering-safety.md).
5. **A validação** está distribuída por todas as etapas. O que cada
   verificação comprova, e o que não comprova, está reunido em
   [Validação e limites](validation-limits.md).

## Pilha de software

| Componente | Papel neste projeto |
| --- | --- |
| Python 3.12+ | Linguagem; `requires-python = ">=3.12"` em `pyproject.toml` |
| NumPy | Álgebra linear: DLT da homografia, SVD, projeção, solução das âncoras por mínimos quadrados |
| SciPy | `solve_ivp` integra a EDO do voo; `least_squares` ajusta os voos |
| PyAV (`av`) | Bindings do FFmpeg no mesmo processo: decodificação, codificação, cópia do stream de áudio, verificação |
| Pillow | Desenha anéis, rastros, a quadra e texto em cada frame |
| uv | Instala o ambiente travado (`uv.lock`) e executa comandos |
| Sphinx + MyST + Furo | Gera este site de documentação (o grupo de dependências `docs`) |

As dependências de execução são exatamente `numpy`, `scipy`, `av` e `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
Nenhum subprocesso ou comando de shell é montado a partir de nomes de arquivo;
o trabalho com vídeo passa pelo PyAV no mesmo processo Python
([docstring do módulo `render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Por que não há modelo incluído

Encontrar uma peteca em um frame (detecção) e decidir onde ela está em 3D
(reconstrução) são problemas separados. Este projeto faz apenas o segundo, e
apenas sob suposições explícitas. Não há detector, rede neural nem pesos de
modelo para baixar. Você traz detecções de qualquer ferramenta em que
confie, no formato `shuttle-replay/tracks/v1` descrito em
[os esquemas](schemas.md).

Assim todo número continua rastreável. Cada frame da análise rotula a posição
da peteca com uma camada de procedência
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)):

- `observed_pixel`: sua detecção, sem alterações, ou nula quando não houve.
- `human_review`: um contato, região de queda ou ponto de calibração que uma
  pessoa inseriu.
- `conditional_model`: o modelo físico ajustado, que só é tão bom quanto a
  calibração e a revisão das quais depende.
- `display_interpolation`: linhas que o renderizador desenha entre amostras do
  modelo.

Uma detecção perdida nunca é preenchida como se tivesse sido observada, e o
modelo nunca é rotulado como medição.

## Roteiro de leitura sugerido

Se você é iniciante em visão computacional, leia nesta ordem:

1. [Calibração da câmera](camera-calibration.md): como pixels se relacionam
   com metros, e por que uma única câmera não enxerga profundidade sozinha.
2. [Física da trajetória](trajectory-physics.md): como a física e os
   contatos revisados preenchem a profundidade que falta.
3. [Observações e tempo](observations-timing.md): por que os timestamps vêm
   do contêiner de vídeo e não de um contador de frames.
4. [Renderização e segurança da saída](rendering-safety.md): como o MP4 é
   construído e protegido.
5. [Validação e limites](validation-limits.md): como ler os diagnósticos e
   onde eles deixam de valer.

Para passos práticos, veja [Primeiros passos](getting-started.md),
[o guia do usuário](guide.md) e [o fluxo de trabalho](workflow.md).
