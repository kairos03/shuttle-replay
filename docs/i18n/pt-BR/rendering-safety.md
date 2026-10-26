# Renderização e segurança da saída

O renderizador produz um MP4 de replay: o frame original à esquerda e uma vista
superior da quadra à direita. Ele tem duas tarefas que importam tanto quanto o
próprio desenho: manter intacta a temporização do original e nunca danificar
nem sobrescrever um arquivo. Tudo nesta página está em
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Decodificar, desenhar, codificar

O PyAV encapsula as bibliotecas do FFmpeg dentro do processo Python. O
renderizador abre o original, pega o primeiro stream de vídeo e, se houver, o
primeiro stream de áudio, e faz o demux dos seus pacotes na ordem do arquivo
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```{figure} assets/technical/pt-BR/render-pipeline.svg
:alt: Pipeline de renderização: source.mp4 é demultiplexado; pacotes de vídeo viram o quadro k, são verificados, desenhados e codificados em staging.mp4; o áudio é copiado
:class: technical-figure
:width: 100%

Caminho de cada quadro dos pacotes de origem até o arquivo temporário.
```

Para cada frame de vídeo decodificado `k`, antes de desenhar, ele verifica
que:

- a análise tem um frame `k`, e o seu `frame_id` é igual a `k`,
- o frame decodificado tem um PTS, e
- o tempo decodificado difere do `pts_s` da análise em no máximo `1e-3` s.

Qualquer falha lança `RenderError`, indicando o frame. Após o último pacote, o
número de frames decodificados deve ser igual ao número de frames da análise.

A codificação tenta `libx264`, depois `h264`, depois `mpeg4`, o que o build
local do FFmpeg conseguir abrir, com formato de pixel `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
O codificador usa o `time_base` do vídeo original; somente para `mpeg4` com um
denominador de `time_base` acima de 65535 ele recorre a 1/60000 s. Cada frame
de saída recebe o tempo do frame original convertido para esse `time_base`,
então uma taxa de quadros variável continua variável. O `rate=30` passado
quando o stream é criado é um valor nominal; os tempos dos frames vêm do
original.

Os timestamps do vídeo de saída são arredondados para ticks do codificador. A
verificação confere a contagem de frames de saída, mas não compara cada PTS de
vídeo de saída decodificado com o original. A verificação do áudio compara os
tempos de apresentação dos pacotes e o primeiro offset A/V decodificado
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Layout

```{figure} assets/technical/pt-BR/render-layout.svg
:alt: Layout 6:4: à esquerda o quadro original sem escala (W x H); à direita a vista superior com a quadra ajustada a 4/6 W
:class: technical-figure
:width: 100%

Quadro de saída: painel de origem e vista superior na proporção de largura 6:4.
```

`W` e `H` são a largura e a altura do original arredondadas para cima até
números pares (o H.264 precisa de tamanhos pares); a largura da vista superior
é `2 * round(W * 4 / 6 / 2)`. O frame original é colado em escala 1.0 no canto
superior esquerdo; o arredondamento para cima acrescenta no máximo uma linha ou
coluna de pixels pretos. A vista superior
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
escala a quadra de 6.10 x 13.40 m para caber no seu painel com uma margem e
mantém as proporções da quadra.

O Pillow desenha as sobreposições
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)):

- anel verde: a sua detecção (`shuttle_observed_px`);
- anel laranja: a projeção do modelo (`shuttle_model_px`);
- caixas dos jogadores, se os seus tracks as contiverem;
- vista superior: linhas da quadra, a rede, o rastro do modelo do voo atual,
  um ponto cujo tamanho cresce com a altura do modelo, `z` e a velocidade
  aproximada do modelo;
- voos com queda: a região revisada como um retângulo tracejado e, a partir do
  tempo de queda, uma cruz laranja no ponto de queda do modelo.

Frames de corte de câmera mostram "camera cut: excluded from replay" e nenhuma
sobreposição da peteca. Entradas sintéticas acrescentam `SYNTHETIC` ao título
da vista superior.

## Áudio: cópia do stream, não recodificação

O áudio não é decodificado nem recodificado. Cada pacote de áudio é copiado
para o novo contêiner com seus timestamps originais
(`add_stream_from_template`, depois `mux`). Pacotes sem DTS são ignorados.
Isso preserva o offset inicial do áudio do original e quaisquer lacunas, o que
importa porque arquivos reais muitas vezes começam o áudio uma fração de
segundo depois do vídeo.

A cópia do stream só funciona se o MP4 aceitar o codec de áudio do original.
Se o stream não puder ser criado ou um pacote não puder passar pelo mux, a
renderização falha com um `RenderError` que descreve a falha da cópia do
stream; erros de criação do stream incluem o codec. Não há alternativa de
recodificação, então nem todo formato de áudio é suportado. Um original sem
áudio produz um MP4 silencioso, reportado como
`"source has no audio stream; output is silent"`.

## Verificação antes da publicação

O renderizador grava em um arquivo de staging e o verifica antes que qualquer
coisa apareça no seu caminho de saída:

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   decodifica completamente o arquivo de staging; a contagem de frames de vídeo
   decodificados deve ser igual à contagem de frames da análise.
2. Com áudio, o primeiro tempo de áudio menos o primeiro tempo de vídeo deve
   coincidir com o do original dentro de `1e-3` s
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. A lista de tempos dos pacotes de áudio deve ser idêntica à do original
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

O relatório de renderização registra esses resultados:
`pts_check.max_abs_diff_s`, `audio.av_offset_error_s`, `audio.packets_copied`
e as contagens de `verification`.

## Saída sem sobrescrita

Antes de qualquer trabalho,
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
recusa um original inexistente, uma saída que resolve para o original
(incluindo um link simbólico ou um hard link para ele) e qualquer caminho de
saída que já exista, mesmo um link simbólico quebrado. Nada é sobrescrito,
nunca.

O arquivo de staging é criado por `tempfile.mkstemp` no diretório de saída com
um nome único da forma `.<stem>.<random>.staging.mp4`. Após a verificação,
`os.link` cria a saída como um hard link para ele. Um hard link falha se o nome
de destino existir, então a publicação não pode substituir um arquivo que
tenha aparecido durante a renderização. O nome de staging é removido em um
bloco `finally` tanto em caso de sucesso quanto de falha, então um arquivo
alheio no diretório nunca é tocado. Isso depende de o sistema de arquivos do
diretório de saída suportar hard links.

A CLI aplica a mesma regra ao JSON: `_refuse_existing` verifica cada caminho de
saída de antemão, e `_dump` abre arquivos em modo de criação exclusiva
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` publica o vídeo antes de gravar os dois arquivos JSON, então as três
saídas não formam uma única transação atômica. Ele verifica as três saídas
primeiro, de modo que uma entrada fornecida que por acaso esteja em
`<out-dir>/analysis.json` é recusada em vez de sobrescrita. Nomes de arquivo
nunca chegam a um shell; o teste
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` renderiza a
partir de um nome que contém metacaracteres de shell.

Relacionado: [Observações e tempo](observations-timing.md) para `pts_s`,
[Validação e limites](validation-limits.md) para o que as verificações de
mídia comprovam, [os esquemas](schemas.md) para o relatório de renderização.
