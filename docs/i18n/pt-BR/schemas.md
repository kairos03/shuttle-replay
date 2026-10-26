# Formatos de entrada e saída (v0.1)

Todas as coordenadas em metros usam o referencial da quadra: X ao longo da
largura e Y ao longo do comprimento, com o limite externo da quadra (bordas
externas das linhas de limite) em X = 0 .. 6.10 e Y = 0 (fundo) .. 13.40
(perto); Z para cima (0 = piso). O plano da rede é Y = 6.70. As linhas têm
40 mm de largura; informe os pontos do piso no centro das linhas: linhas
externas X = 0.02 / 6.08 e Y = 0.02 / 13.38, linhas laterais de simples
X = 0.48 / 5.62, linhas de saque curto Y = 4.70 / 8.70, linhas de saque longo
de duplas Y = 0.78 / 12.62, linha central X = 3.05.
As coordenadas de imagem são pixels do vídeo original (x para a direita, y
para baixo). Os tempos são timestamps de apresentação (PTS) do original em
segundos, como decodificados pelo FFmpeg/PyAV (`frame.pts * time_base`),
nunca `frame_index / fps`.

Execute `shuttle-replay demo --out-dir demo` para obter em `demo/inputs/` um
exemplo sintético completo de cada arquivo abaixo.

## Entrada de calibração — `shuttle-replay/calibration-input/v1`

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

- Os pontos `role: "fit"` (≥ 4, não colineares, não duplicados) estimam a
  homografia do piso. Os pontos `role: "heldout"` (≥ 1) nunca são ajustados e
  são relatados separadamente como erros reservados em pixels e metros.
- As `net_anchors` (≥ 2, Z > 0.1 m) recuperam a coluna vertical da matriz da
  câmera. Com exatamente duas âncoras a coluna fica quase exatamente
  determinada, então o resíduo delas diz pouco; a saída inclui um relatório de
  sensibilidade (deslocamento vertical de um ponto 3 m acima da rede quando
  uma âncora se move `uncertainty_px`).
- Números não finitos, pontos de ajuste colineares/duplicados, âncoras no
  nível do piso e câmeras abaixo do piso são rejeitados.

A saída (`shuttle-replay/calibration/v1`) contém, por segmento, `P` (3×4,
metros → pixels), `H_world_to_image` / `H_image_to_world` (apenas piso),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` e uma cópia das entradas.

## Trilhas — `shuttle-replay/tracks/v1`

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

- Uma entrada por quadro original decodificado, na ordem de decodificação;
  `frame_id` deve ser igual ao índice de decodificação (o renderizador
  verifica isso e o PTS de cada quadro).
- `frame_id` e `pts_s` devem ser estritamente crescentes e finitos.
- `segment_id` identifica uma tomada de câmera contínua que tem calibração;
  `null` marca cortes de câmera / close-ups / replays, que são excluídos. Um
  segmento deve ser contíguo; um id de segmento que reaparece após outro
  segmento é rejeitado (dê à tomada posterior seu próprio id e calibração).
- `shuttle: null` significa "sem detecção". Continua null em todas as saídas.

## Anotações de revisão — `shuttle-replay/review/v1`

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

- Os contatos são contatos de raquete revisados. `time_s` é o timestamp
  revisado do contato e se torna o tempo zero do voo, mesmo quando a primeira
  detecção da peteca chega depois. Ele deve estar dentro do seu segmento de
  câmera e dentro de `time_bracket_s` (≤ 0.5 s de largura). Os contatos de um
  segmento devem ser estritamente crescentes. A v0.1 não refina os instantes
  de contato automaticamente; refine-os revisando os quadros e editando
  `time_s`.
- Prior de posição: `image_px` (pixel de contato revisado, interseccionado com
  o plano Z = `height_m` pela câmera P completa) ou `court_xy_m`. `height_m`
  é um prior revisado com `height_sigma_m`; `xy_sigma_m` é opcional (padrão
  0.5 m).
- Um voo vai de um contato até o contato seguinte do mesmo segmento
  (`intercepted_by_next_contact`, nunca forçado ao piso). Apenas o último
  contato de um segmento pode ter uma entrada `flight_ends`: `landing_region`
  (contato com o piso restrito à caixa revisada dentro do intervalo de tempo)
  ou `open` (ajuste até a última observação do segmento, ou até um `until_s`
  revisado opcional). Entrada ausente = open.
- Chaves de `physics` (todas opcionais): `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Saída da análise — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s` (contato revisado), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` no contato), `fit` (RMS / p90 / máximo de
  reprojeção em px, número de observações, status do otimizador), `gates`
  (viabilidade em relação ao piso e à rede; altura sobre a rede ≥ 1.524 m
  quando o voo cruza a rede), `parameters_at_bound` (um ajuste preso em um
  limite do otimizador é rejeitado), `accepted`, `model_speed_km_h` e
  `model_speed_coarse_km_h`, `first_observation_delay_s`,
  `observation_frame_ids`, `landing` (voos com queda;
  `exact_coordinate_measured: false`) e
  `unreturned_floor_crossing_prediction` (voos interceptados/abertos;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px` (detecção fornecida ou null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (apenas modelo aceito, mesmo
  segmento), `model_flight_id`, `layer` (`conditional_model`, `observed_pixel`,
  `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Relatório de renderização

`render_report.json` registra o codificador, o número de quadros, a diferença
máxima entre o PTS original decodificado e o PTS das trilhas, o layout 6:4, se
o áudio foi preservado e uma decodificação completa do MP4 gravado.
