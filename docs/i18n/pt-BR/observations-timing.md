# Observações e tempo

Um ajuste de voo compara as posições do modelo com as detecções **em instantes
específicos**. Se esses instantes estiverem errados, uma trajetória correta
parece errada e uma errada pode parecer certa. Esta página explica de onde vêm
os tempos, o que os contratos de entrada exigem, como a evidência é separada da
revisão e como o tempo é amostrado para o modelo e para o desenho.

## O tempo vem do PTS, não da contagem de frames

Os contêineres de vídeo armazenam um timestamp de apresentação (PTS) para cada
frame como uma contagem inteira de ticks, com um `time_base` que diz quanto
dura um tick. O tempo do frame em segundos é:

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

Muitas gravações de celular e de tela têm **taxa de quadros variável** (VFR):
as durações dos frames diferem. Calcular `frame_index / fps` então se afasta
do tempo real. Por isso o formato de tracks armazena `pts_s` por frame, tal
como decodificado pelo FFmpeg/PyAV (veja [os esquemas](schemas.md)). A demo
sintética usa VFR de propósito: com `time_base` 1/30000 s, a cada sete frames
um dura 1001 ticks em vez de 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

Mais tarde, o renderizador confere cada frame decodificado com o seu `pts_s`;
veja [Renderização e segurança da saída](rendering-safety.md).

## Contratos de entrada

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
e
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
lançam `InputError` na primeira inconsistência. Nada é reordenado,
deduplicado ou corrigido.

Tracks (`shuttle-replay/tracks/v1`):

- `frame_id` é um inteiro estritamente crescente; `pts_s` é finito e
  estritamente crescente.
- `segment_id` nomeia uma tomada contínua de câmera. `null` marca um corte de
  câmera, um close ou um replay. Um id de segmento que reaparece depois de um
  segmento diferente é rejeitado, então cada tomada precisa de seu próprio id
  e de sua própria calibração.
- `shuttle` é `null` (sem detecção) ou tem `u` e `v` finitos. As caixas dos
  jogadores devem ser quatro números finitos.

O intervalo de tempo de cada segmento é o PTS do seu primeiro e do seu último
frame. Todo segmento precisa de uma calibração
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Revisão (`shuttle-replay/review/v1`):

- Os ids de contato são strings únicas. Cada contato fica dentro do intervalo
  PTS do seu segmento e dentro do seu próprio `time_bracket_s`, que pode ter no
  máximo 0.5 s de largura.
- Os contatos de um segmento são estritamente crescentes no tempo, na ordem da
  lista.
- `height_m` está no intervalo aberto (0, 4) m e `height_sigma_m` é positivo.
  Cada contato precisa de `image_px` ou `court_xy_m`.
- Somente o último contato de um segmento pode ter uma entrada `flight_ends`,
  do tipo `open` ou `landing_region`. Um intervalo de queda deve começar depois
  do contato; o `min` da região deve estar abaixo do seu `max`. O `until_s` de
  um final `open` deve vir depois do contato e ficar dentro do segmento.

## Evidência versus revisão

Dois tipos de entrada desempenham papéis diferentes:

- **Evidência observada**: suas detecções. Elas entram no ajuste apenas como
  resíduos em pixels e são copiadas sem alteração para `shuttle_observed_px`.
  Um frame com `shuttle: null` permanece `null` em todas as saídas.
- **Restrições revisadas**: contatos, regiões de queda, pontos de calibração.
  As posições e alturas dos contatos entram como priors ponderados por sigma;
  as extremidades de queda usam escalas de penalidade fixas. Os pontos de
  calibração determinam a câmera de antemão. Os instantes de contato são
  fixos, e o tempo de queda é ajustado dentro do seu intervalo.

Quando o modelo preenche um frame sem detecção, a `layer` desse frame é
`conditional_model` enquanto `shuttle_observed_px` permanece `null`. O teste
`test_missing_detection_provenance_is_null_not_filled` verifica exatamente
isso.

## Segmentação de voos

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
agrupa os contatos por segmento e transforma cada contato em um voo. Um voo
nunca atravessa um segmento de câmera. Suas observações são os frames do
segmento com uma detecção e

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

A guarda descarta detecções bem no momento de um contato, quando a peteca
muitas vezes se confunde com a raquete. `observation_frame_ids` e
`observation_time_offsets_s` em cada registro de voo mostram exatamente quais
frames foram usados, com deslocamentos medidos a partir de `t0`.

## Amostragem do modelo versus exibição

Existem três amostragens diferentes, e apenas a primeira é por frame de vídeo:

1. **Por frame.** Para cada frame dentro do intervalo de tempo de um voo
   aceito, `shuttle_model_xyz_m` é o modelo avaliado no próprio PTS desse
   frame, e `shuttle_model_px` é a sua projeção através de `P`
   ([laço de frames](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   Frames de corte de câmera recebem `layer: "excluded_camera_cut"`, sem modelo
   e sem jogadores, mesmo que exista uma detecção bruta
   (`raw_detection_ignored`).
2. **Dentro do ajuste.** 41 amostras igualmente espaçadas verificam as
   penalidades de piso e de rede; 201 amostras alimentam os portões de
   aceitação. Veja [Física da trajetória](trajectory-physics.md).
3. **Exibição.** O rastro da vista superior é uma polilinha que passa apenas
   por amostras anteriores do modelo por frame do **mesmo** voo
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   Ele para no primeiro frame com um `model_flight_id` diferente, então um
   rastro nunca liga dois voos nem atravessa um corte de câmera. Essas linhas
   são `display_interpolation`, não dados.

## Tolerâncias que são realmente verificadas

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

Relacionado: [os esquemas](schemas.md) para cada campo,
[o fluxo de trabalho](workflow.md) para produzir tracks a partir do seu
próprio detector.
