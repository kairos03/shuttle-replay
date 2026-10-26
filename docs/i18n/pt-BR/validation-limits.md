# Validação e limites

`shuttle-replay` reporta muitos números sobre os próprios resultados. Cada um
responde a uma pergunta específica. Esta página diz, para cada verificação, o
que ela mostra, o que não mostra e qual teste do repositório a exercita. Nenhum
número de exatidão ou de velocidade para filmagens reais é dado aqui, porque o
projeto não mediu nenhum.

## O que cada verificação comprova

**Erro de piso reservado** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Comprova: a homografia do piso prevê pontos da quadra aos quais não foi
ajustada. Não comprova: nada sobre alturas, as âncoras da rede ou a peteca.

**Resíduos e sensibilidade das âncoras da rede** (`net_anchor_residuals_px`,
`net_anchor_sensitivity`). Com duas âncoras a coluna vertical fica quase
exatamente determinada, então o resíduo é próximo de zero quase por
construção. O valor de sensibilidade mostra quanto um ponto de referência 3 m
acima da rede se move quando uma coordenada de uma âncora se move pela sua
incerteza em pixels declarada. É um "e se", não um intervalo de confiança.
Veja [Calibração da câmera](camera-calibration.md).

**Erro de reprojeção** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Comprova: a projeção do modelo passa perto das suas
detecções 2D. Não comprova: que a trajetória 3D esteja certa. Uma
profundidade diferente com uma velocidade diferente pode se projetar quase nos
mesmos pixels, que é a subdeterminação descrita em
[Física da trajetória](trajectory-physics.md). O limite de aceitação padrão é
8.0 px RMS.

**Portões de piso e de rede** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Passar mostra que as 201 alturas amostradas são de pelo menos −0.02 m, que todo
cruzamento detectado, interpolado entre amostras adjacentes, é de pelo menos
1.524 m, e que um cruzamento ocorre quando é exigido. Essas verificações são
checagens finitas sobre amostras; não estabelecem plausibilidade física geral
nem exatidão no mundo real.

**`parameters_at_bound` e `optimizer_success`**. Um ajuste não convergido é
rejeitado. Os sete parâmetros de estado/arrasto são marcados quando a sua
distância a um limite é menor que 0.1% do seu intervalo permitido. Um ajuste
marcado é rejeitado. O tempo de queda não é incluído neste diagnóstico.
Passar não estabelece identificabilidade, unicidade nem ausência de influência
dos priors.

**Verificações de mídia** (relatório de renderização). Comprovam: cada frame
original foi pareado por índice e PTS, a saída decodifica com a contagem
correta de frames e os pacotes de áudio mantiveram seus tempos. Não comprovam:
que o seu `pts_s` veio do mesmo arquivo em que as detecções foram feitas, além
da própria correspondência de PTS.

**Recuperação sintética** (`demo`, `synthetic_recovery.json`).
`synthetic_recovery.json` reporta comparações com a verdade de referência
sintética. Os testes afirmam tolerâncias de recuperação selecionadas para
casos sintéticos específicos; gerar o relatório por si só não impõe essas
tolerâncias. Nenhum dos dois mostra exatidão em vídeo real. O `label` do
arquivo diz isso: "SYNTHETIC ground-truth recovery; not evidence of accuracy
on real video".

## Onde a incerteza é qualitativa

O ajuste tem sigmas, mas a saída não as transforma em barras de erro. Não há
covariância, nem bootstrap, nem intervalo de confiança para posição,
velocidade ou ponto de queda. Em vez disso, a incerteza é expressa por
rótulos: `conditional_model`, `exact_coordinate_measured: false`,
`speed_scope` e a lista `assumptions` em todo arquivo de análise
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
O arredondamento aproximado da velocidade em 5 km/h é uma escolha de exibição,
não uma estimativa de erro.

## Por que não é outra coisa

- **Não é 3D medido.** Uma câmera fornece raios, não pontos. A profundidade
  vem do modelo físico mais os seus contatos revisados.
- **Não é profundidade densa.** Não há mapa de profundidade por pixel nem rede
  de profundidade aprendida. Apenas a peteca ao longo dos voos ajustados
  recebe uma posição 3D.
- **Não é IN/OUT automático.** `landing.inside_court` compara um ponto do
  modelo com o limite externo da quadra. O ponto é puxado suavemente em
  direção à região que você desenhou, então a resposta reflete principalmente
  a sua revisão; a pertença à região não é um requisito rígido de aceitação
  (`landing.within_region` a reporta com uma tolerância de 1 mm). Não há
  lógica de marcação de linhas, nem regra de simples/duplas, nem medição de
  onde a peteca tocou.

## Ordem de depuração

Quando um voo parecer errado, leia da base do pipeline para cima:

1. **Calibração.** Erros grandes em `heldout_summary` ou um
   `max_vertical_shift_m` grande: corrija primeiro os pontos ou as âncoras.
   Nada a jusante consegue se recuperar.
2. **Entradas.** `observation_frame_ids` e `first_observation_delay_s`: a
   janela contém as detecções que você espera?
3. **Status.** `insufficient_observations` significa poucas detecções;
   `rejected_by_gates_or_fit` significa olhar os dois itens seguintes.
4. **Ajuste.** `optimizer_success`, `parameters_at_bound`, RMS e máximo de
   reprojeção. Um máximo enorme com um RMS baixo aponta para uma única
   detecção ruim.
5. **Portões.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. Um portão de rede com
   falha costuma indicar um contato do lado errado ou uma altura de contato
   errada.
6. **Relatório de renderização.** Divergência de PTS ou erros de contagem de
   frames significam que os tracks não pertencem exatamente a esta
   decodificação do vídeo.

## Mapa de evidências

| Afirmação | Teste |
| --- | --- |
| Pontos reservados reportados separadamente; `H` rotulada somente Z=0 | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Entradas de calibração ruins rejeitadas | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Tracks ou revisão inconsistentes rejeitados, não corrigidos | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| O contato, não a primeira detecção, é o tempo zero | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| Os voos ficam dentro de um segmento | `test_flights_never_bridge_camera_segments` |
| Detecções ausentes continuam nulas | `test_missing_detection_provenance_is_null_not_filled` |
| A queda é uma restrição, não uma medição | `test_landing_region_is_a_constraint_not_a_measurement` |
| Voos interceptados não são forçados a cair | `test_intercepted_flight_is_not_forced_to_land` |
| Portões de rede e de piso | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| Ajustes presos a um limite rejeitados; janela `until_s` | `test_open_flight_window_and_bound_pinned_fits` |
| Centros das linhas da quadra | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| Verificações de PTS e contagem de frames; nomes de arquivo hostis | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Os rastros ficam dentro de um voo | `test_trails_stay_inside_one_flight_and_segment` |
| Sem sobrescrita do original ou de arquivos existentes | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Offset e lacunas do áudio preservados | `test_audio_is_stream_copied_with_source_relative_offset` |
| Artefatos da demo de ponta a ponta | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

Todos os testes ficam em
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
A maioria dos testes de voo roda sobre a cena sintética de
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py),
então eles confirmam comportamento e contratos, não exatidão no mundo real. Não
cobertos pelos testes: distorção da lente, que a ferramenta não modela, e
codecs de áudio diferentes do AAC usado nos testes.

Relacionado: [o fluxo de trabalho](workflow.md) para a lista de limites,
[o guia do usuário](guide.md) para ler os resultados.
