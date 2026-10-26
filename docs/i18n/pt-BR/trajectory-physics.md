# Física da trajetória

Uma câmera vê uma peteca como um pixel. Todo ponto ao longo da linha de visão
que passa por esse pixel, perto ou longe, cai no mesmo pixel, então um único
frame não consegue informar a profundidade. Esta página explica como
`shuttle-replay` ainda assim transforma uma sequência de pixels em um voo 3D,
acrescentando física e restrições revisadas, e o que o resultado significa e
não significa.

## O problema inverso

Pense em cada detecção como um raio saindo da câmera. Um voo é uma curva que
precisa passar perto de cada raio no momento certo. Muitas curvas conseguem
isso: um voo lento e próximo e um rápido e distante podem produzir trilhas de
pixels parecidas. O problema é subdeterminado. A ferramenta escolhe uma curva
exigindo que ela:

- obedeça à gravidade e ao arrasto do ar (o modelo abaixo),
- comece perto da posição e da altura do contato revisado, no instante do
  contato revisado,
- seja puxada suavemente em direção ao próximo contato revisado ou a uma
  região de queda revisada, ou pare no fim da janela observada (os resíduos
  das extremidades são penalidades, não requisitos rígidos de aceitação), e
- permaneça acima do piso e passe por cima da rede quando deve cruzá-la.

A trajetória 3D ajustada é, portanto, um **modelo condicional**: a curva mais
consistente dadas a sua calibração e a sua revisão, não uma medição
([docstring do módulo `analysis.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## O modelo de voo

O estado é a posição `r = (x, y, z)` em metros e a velocidade `v` em m/s. As
equações de movimento
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)):

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

O arrasto aponta contra o movimento e cresce com o quadrado da velocidade. Uma
leitura útil de `k`: uma peteca caindo em linha reta para de acelerar quando o
arrasto iguala a gravidade, na velocidade terminal `sqrt(g / k)`. Com o prior
padrão `k = 0.18 1/m`, isso dá cerca de 7.4 m/s. Uma peteca golpeada em alta
velocidade, portanto, desacelera bruscamente; o modelo não tem spin,
capotamento nem vento.

Os sete parâmetros ajustados são `[x, y, z, vx, vy, vz, k]` no **tempo de voo
zero**, que é o instante do contato revisado, não o da primeira detecção
([docstring do módulo `physics.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
As detecções costumam começar alguns frames depois do contato porque a raquete
ou um jogador esconde a peteca. Esses frames são medidos como deslocamentos a
partir do contato, então uma primeira detecção tardia não move o início do voo
(`first_observation_delay_s` reporta o intervalo).

## Integração numérica

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
integra as equações com `solve_ivp` do SciPy (seu método Runge-Kutta explícito
padrão) a partir de `t = 0`, com `rtol=1e-7`, `atol=1e-8`, `max_step=0.02`
segundos e saída densa, e depois avalia as posições nos instantes pedidos.
Tempos não finitos e tempos abaixo de `-1e-9` s são rejeitados; valores
negativos minúsculos acima desse limite são fixados em zero. As tolerâncias do
integrador controlam o erro de integração numérica; não são limites da
exatidão da reconstrução.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
usa uma função de evento sobre `z` (somente descendente, terminal) com
tolerâncias mais estritas (`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`) em um
horizonte de 10 s.

## O que é minimizado

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
monta um único vetor de resíduos. Cada entrada é uma diferença dividida por uma
escala, de modo que "1" significa "um erro esperado":

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` é a duração do voo. O prior do contato vem de
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54):
se o contato tem `image_px`, o raio que passa por esse pixel é intersectado com
o plano na `height_m` revisada; caso contrário, `court_xy_m` e `height_m` são
usados diretamente. As sigmas vêm de `xy_sigma_m` e `height_sigma_m` em cada
contato, recorrendo aos valores padrão mostrados.

No termo da rede, `h_net` é a altura interpolada onde a trajetória de 41
amostras cruza `Y = 6.70` pela primeira vez; se a trajetória nunca cruza,
`h_net` conta como 0. Este termo usa 1.55 m (altura do poste) como está escrito
no código; o portão de aceitação abaixo usa 1.524 m (centro da rede).

`least_squares` do SciPy minimiza a soma com `loss="soft_l1"` e
`f_scale=1.5`, de modo que algumas detecções ruins puxam menos do que com
quadrados simples. Ele parte de seis pontos iniciais: `k` em `0.1, 0.2, 0.35`
combinado com uma velocidade extra para cima de `1.0` ou `3.0` m/s somada a uma
estimativa balística em direção ao alvo final. Vence o resultado de menor
custo. Os limites mantêm a busca fisicamente plausível
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)):

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

Os sete parâmetros de estado/arrasto são marcados em `parameters_at_bound`
quando a sua distância a um limite é menor que 0.1% do seu intervalo
permitido
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
Um ajuste marcado é rejeitado. O tempo de queda não é incluído neste
diagnóstico. Passar não estabelece identificabilidade, unicidade nem ausência
de influência dos priors.

## Como um voo termina

Os voos são construídos por segmento de câmera a partir dos contatos em ordem
temporal
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)):

- **`intercepted_by_next_contact`**: outro contato vem a seguir no mesmo
  segmento. A duração é o tempo entre contatos; o final é puxado em direção ao
  prior do próximo contato. Um cruzamento da rede é exigido quando os dois
  priors de contato ficam em lados opostos da rede.
- **`landing_region`**: o último contato de um segmento tem um final de queda
  revisado. Os resíduos do contato e da extremidade de queda puxam suavemente o
  ajuste em direção à extremidade revisada. O tempo de queda é limitado pelo
  intervalo revisado, mas a altura da extremidade e a pertença à região não são
  requisitos rígidos de aceitação. `landing.within_region` reporta a pertença
  com uma tolerância de 1 mm; ele não controla a aceitação. Um cruzamento é
  exigido quando o início e o centro da região ficam em lados opostos da rede.
- **`open_segment_end`**: qualquer outro caso. A janela termina no fim do
  segmento ou em `until_s`, a duração do ajuste é o deslocamento da última
  observação, e nenhum cruzamento da rede é exigido.

Menos de `min_observations` (padrão 4) detecções na janela resulta em
`status: "insufficient_observations"` sem ajuste.

## Portões de aceitação

Após o ajuste, a trajetória é amostrada em 201 pontos e verificada por
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106):
`floor_ok` exige que o ponto mais baixo esteja em -0.02 m ou acima. `net_ok`
exige um cruzamento quando um era necessário, e **todo** cruzamento detectado
entre amostras adjacentes deve estar em 1.524 m ou acima, quer um cruzamento
fosse esperado ou não. Um voo só é aceito se o otimizador reportar sucesso, os
dois portões passarem, o RMS de reprojeção for no máximo `max_accept_rms_px`
(padrão 8.0 px) e nenhum dos sete parâmetros de estado/arrasto estiver
marcado. Voos rejeitados mantêm seus parâmetros para inspeção, mas não são
desenhados como camada do modelo.

## Velocidade e a queda contrafactual

`model_speed_km_h` é `|v(0)| * 3.6`, a velocidade inicial do modelo, e
`model_speed_coarse_km_h` a arredonda para os 5 km/h mais próximos para
exibição. Não é uma leitura de radar.

Para voos que não terminam em uma região de queda, se o modelo alcançasse o
piso depois de o voo ter terminado, a análise acrescenta
`unreturned_floor_crossing_prediction` com
`kind: "counterfactual_if_unreturned"` e `observed: false`. Isso responde a
"onde este modelo cairia se ninguém a tivesse devolvido", não para onde a
peteca foi. Para voos com queda, `landing.xy_m` é o ponto final do modelo
puxado suavemente em direção à sua região (sem garantia de ficar dentro dela),
e `exact_coordinate_measured` é sempre `false`.

Relacionado: [Calibração da câmera](camera-calibration.md) para `P`,
[Observações e tempo](observations-timing.md) para a janela de observação,
[Validação e limites](validation-limits.md) para interpretar `fit` e `gates`.
