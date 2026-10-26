# Fluxo de trabalho

## O que você fornece

- **Detecções** (`tracks.json`): uma entrada por quadro decodificado com PTS,
  id do segmento de câmera, pixel da peteca ou null e caixas de jogadores
  opcionais. Não há detector embutido. Veja [](schemas.md).
- **Entrada de calibração**: por segmento, pelo menos 4 pontos de quadra
  `fit`, alguns pontos `heldout` e o topo dos dois postes da rede (1.55 m).
- **Revisão** (`review.json`): instantes de contato, pixels e alturas que você
  revisou, além de regiões de queda opcionais. Os contatos não são encontrados
  automaticamente.

Qualquer rastreador pode produzir as detecções; por exemplo, você pode
executar por conta própria o TrackNetV3 (MIT) para a peteca e um modelo
Ultralytics YOLO (AGPL-3.0) para os jogadores, com seus próprios checkpoints,
e converter as saídas. Scripts de conversão não fazem parte da v0.1.

## Etapas

1. **Calibrar.** Para cada segmento de câmera, meça ≥ 4 interseções de linhas
   da quadra (papel `fit`), algumas outras como `heldout` e o topo dos dois
   postes da rede.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Verifique `heldout_summary` e `net_anchor_sensitivity` antes de continuar.
2. **Revisar.** Escreva `review.json`: instantes de contato dentro de
   intervalos revisados, pixel do contato e priors de altura e, para o último
   voo de um segmento, uma região de queda opcional ou `open`.
3. **Analisar e renderizar.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Entradas inconsistentes (PTS não monotônico, segmentos não contíguos,
   contatos fora do seu segmento ou intervalo, PTS que não corresponde ao
   vídeo, …) param com código de saída 2 e uma mensagem; nada é corrigido
   silenciosamente.

## O que cada comando faz

- **`calibrate`**: homografia a partir de ≥ 4 pontos do piso revisados, mais a
  coluna vertical da câmera a partir de ≥ 2 âncoras elevadas da rede. Os
  pontos do piso reservados nunca são usados no ajuste e são relatados
  separadamente. Entradas degeneradas, duplicadas, colineares e não finitas
  são rejeitadas. A homografia do piso nunca é usada para pontos no ar.
- **`analyze`**: um voo por contato revisado, temporizado a partir do contato
  revisado. Cortes de câmera são excluídos e os voos nunca atravessam
  segmentos. Cada voo termina no contato seguinte, em uma região de queda
  revisada (uma restrição, não uma coordenada medida) ou na última observação
  do segmento. Filtros de piso e de rede rejeitam ajustes inviáveis.
  Detecções ausentes continuam null.
- **`render`**: verifica cada quadro original decodificado em relação ao PTS
  das trilhas e desenha as caixas de jogadores fornecidas, os anéis da peteca
  observada (verde), os anéis do modelo (laranja) e uma vista superior da
  quadra em um layout 6:4. O áudio original é copiado como stream sem
  recodificação. Saídas existentes nunca são sobrescritas.
- **`demo`**: gera um rali sintético e executa todo o pipeline.

## Lendo a saída

| Camada | Significado |
| --- | --- |
| `observed_pixel` | detecção fornecida, inalterada; null quando ausente |
| `human_review` | seus contatos, regiões de queda e pontos de calibração |
| `conditional_model` | modelo físico ajustado aos pixels observados sob seus priors |
| `display_interpolation` | linhas e marcadores desenhados apenas pelo renderizador |

As velocidades são a velocidade inicial do modelo ajustado
(`model_speed_km_h`, exibida arredondada para 5 km/h). Trate-as como valores
aproximados do modelo, não como medições.

## Limitações

- Sem detecção de peteca ou de jogadores e sem pesos incluídos.
- Sem localização automática de contatos nem refinamento do instante de
  contato.
- Sem mapas de profundidade densa aprendidos, sem rótulos de golpe aprendidos,
  sem marcações automáticas de IN/OUT.
- A saída 3D é condicional, não medida. Resultados de recuperação sintética
  são sintéticos.
