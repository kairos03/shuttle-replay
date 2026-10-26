# Calibração da câmera

A calibração responde a uma pergunta: para um ponto da quadra, em metros, em
qual pixel a câmera o mostra? `shuttle-replay` responde com uma câmera pinhole
linear estimada a partir de pontos que você localizou manualmente. Esta página
explica os sistemas de coordenadas, as duas matrizes que a ferramenta calcula,
o algoritmo exato e o que significam os erros reportados.

## Dois sistemas de coordenadas

**As coordenadas de imagem** `(u, v)` são pixels do vídeo original: `u` cresce
para a direita, `v` cresce para baixo.

**As coordenadas do mundo** `(X, Y, Z)` são metros em um referencial da quadra
fixado pelas dimensões de quadra da BWF
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)):

```text
      X = 0                X = 6.10
 Y = 0  +--------------------+   far baseline (outer edge)
        |                    |
        |                    |
 Y=6.70 |====== net =========|   net plane; posts 1.55 m, centre 1.524 m
        |                    |
        |                    |
Y=13.40 +--------------------+   near baseline (outer edge)

 Z is up; Z = 0 is the court surface.
```

As linhas têm 40 mm de largura e os pontos de calibração usam **os centros das
linhas**: linhas externas em X = 0.02 / 6.08 e Y = 0.02 / 13.38, laterais de
simples em X = 0.48 / 5.62, linhas de saque curto em Y = 4.70 / 8.70, linhas
de saque longo de duplas em Y = 0.78 / 12.62, linha central X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Inserir uma borda externa onde se espera um centro desloca esse ponto em 2 cm.

## Projeção pinhole

Uma câmera pinhole mapeia um ponto do mundo para um pixel com uma matriz 3x4
`P`:

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

A divisão por `c` é a perspectiva: coisas distantes parecem pequenas. `P`
combina onde a câmera está e como está girada (os parâmetros extrínsecos) com
sua distância focal e o centro da imagem (os intrínsecos). O projeto nunca
separa `P` nessas partes; usa `P` como uma única matriz
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
O centro da câmera `C` é o único ponto com `P * [C, 1] = 0`, então
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Passo 1: a homografia do piso (somente Z = 0)

Para pontos no piso, `Z = 0`, então a terceira coluna de `P` é multiplicada
por zero e desaparece:

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

A matriz 3x3 `H = [p1 p2 p4]` é uma **homografia**. Ela é ajustada a partir
dos seus pontos de piso `role: "fit"` com a transformação linear direta (DLT)
normalizada em
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78):

1. Cada conjunto de pontos é transladado para o seu centroide e escalado para
   que sua distância média ao centroide seja `sqrt(2)`
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   Isso mantém o sistema linear bem condicionado quando os valores em pixels
   estão na casa das centenas e os metros têm um único dígito.
2. Cada correspondência adiciona duas linhas a um sistema linear `A h = 0`.
3. `h` é o vetor singular direito de `A` para o menor valor singular; a
   normalização é desfeita e `H` é escalada para que `H[2, 2] = 1`.

Entradas degeneradas são rejeitadas com `CalibrationError` em vez de produzir
uma matriz ruim: menos de quatro pontos de ajuste, coordenadas duplicadas,
conjuntos de pontos colineares, três pontos colineares entre exatamente
quatro, um segundo menor valor singular abaixo de `1e-9` vezes o maior
(solução não única), ou um número de condição acima de `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

O ajuste é uma DLT normalizada que minimiza um resíduo algébrico sobre todos os
pontos de ajuste, sem refinamento não linear da reprojeção. Não há rejeição de
outliers (não há RANSAC) nem modelo de distorção da lente: um ponto digitado
errado ou uma forte distorção de barril puxa o ajuste inteiro.

`H` descreve apenas o piso. A saída indica isso em `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Retroprojetar um pixel da peteca através de `H` responde a "onde este pixel
estaria se estivesse no piso", o que é errado para qualquer coisa no ar.

## Passo 2: a coluna vertical a partir das âncoras da rede

Os pontos do piso não dizem nada sobre `p3`, a coluna que multiplica a altura.
Para isso são necessários pontos de altura conhecida que não estejam no piso:
normalmente os topos dos dois postes da rede a `Z = 1.55`. Para uma âncora em
`(X, Y, Z)` vista em `(u, v)`, escreva `q = H * [X, Y, 1]`. A condição de
projeção se torna linear em `p3`:

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
empilha essas linhas, exige posto 3, resolve por mínimos quadrados e monta
`P = [h1 h2 p3 h3]`, onde `h1`, `h2`, `h3` são as colunas de `H`. Três
incógnitas e duas linhas por âncora significam que duas âncoras dão quatro
equações: um sistema quase exatamente determinado. É por isso que um resíduo
de âncora pequeno (`net_anchor_residuals_px`) comprova pouco. As âncoras devem
estar elevadas (`Z > 0.1 m`) e deve haver pelo menos duas.

Por fim,
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
rejeita uma câmera cujo centro não esteja acima do piso, ou uma que colocaria
alguns pontos da quadra à sua frente e outros atrás dela.

## Pontos de ajuste versus pontos reservados

Todo ponto de piso tem um papel
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)):

- Os pontos `fit` constroem `H`. Seus resíduos (`fit_ground_residuals`) são
  erro de treino e espera-se que sejam pequenos.
- Os pontos `heldout` nunca são usados no ajuste. É necessário pelo menos um.
  `heldout_ground_errors` reporta, por ponto, `error_px` (`H` aplicada ao
  ponto do mundo, comparada com o seu pixel) e `error_m` (a inversa de `H`
  aplicada ao seu pixel, comparada com o ponto do mundo). `heldout_summary` dá
  a contagem, a média e o máximo de ambos.

Um exemplo conceitual: os quatro cantos externos como `fit` e duas interseções
de linhas de saque como `heldout`. Se os erros reservados forem muito maiores
que os resíduos de ajuste, um ponto está rotulado errado, clicou-se na borda de
uma linha em vez do seu centro, ou a lente curva as linhas. O erro reservado é
uma verificação apenas do mapeamento do piso; não diz nada sobre alturas.

## Sensibilidade, não um intervalo de confiança

As alturas dependem quase totalmente das âncoras.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
toma um ponto de referência `(3.05, 6.70, 3.0)`, 3 m acima da linha central da
rede, e o projeta com `P`. Depois, para cada âncora e para `u` e `v`
separadamente, desloca o pixel da âncora em `+uncertainty_px` e
`-uncertainty_px` (padrão 3.0), resolve `P` novamente e intersecta o raio que
passa pelo mesmo pixel de referência com o plano da rede `Y = 6.70`.
`max_vertical_shift_m` é a maior mudança de altura. Se uma perturbação fizer a
solução falhar, o deslocamento é reportado como infinito.

Este é um pior caso de uma perturbação por vez para um único ponto. Não é um
intervalo de confiança estatístico, não combina erros de várias âncoras e não
inclui o erro dos pontos de piso.

## Suposições que você está fazendo

- Uma câmera fixa por `segment_id`; um movimento de câmera ou zoom exige um
  novo segmento.
- Linhas retas continuam retas na imagem (sem distorção da lente).
- As âncoras têm as alturas que você informa. Os topos dos postes a 1.55 m e o
  centro da rede a 1.524 m são alturas diferentes.
- O plano do piso não é a peteca. `H` fornece posições no piso; a profundidade
  da peteca vem apenas do ajuste físico descrito em
  [Física da trajetória](trajectory-physics.md).

Veja [os esquemas](schemas.md) para todos os campos de entrada e saída e
[Validação e limites](validation-limits.md) para ler os erros junto com os
diagnósticos de voo.
