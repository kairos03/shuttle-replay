# Guia do usuário do shuttle-replay (v0.1)

`shuttle-replay` é uma ferramenta offline que cria um replay da peteca de
badminton a partir de um vídeo local, de detecções que você já produziu e de
anotações revisadas por uma pessoa. Ela calibra a câmera, ajusta um modelo de
voo com gravidade e arrasto aerodinâmico quadrático às coordenadas de detecção
2D e gera um MP4 que coloca o vídeo original e uma vista superior da quadra
lado a lado na proporção 6:4.

Esta ferramenta é para pesquisa e revisão. Não é um sistema de marcação de
dentro/fora, um classificador de golpes, um detector de peteca nem um radar de
velocidade medida. Cada posição e velocidade 3D na saída é um valor
condicional do modelo que pressupõe sua calibração e suas anotações.

## Instalação

Requer Python 3.12 ou mais recente e [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Os wheels do PyAV incluem o FFmpeg, então não é preciso FFmpeg do sistema.

## Demo sintética

```bash
uv run shuttle-replay demo --out-dir demo
```

Isso cria um rali sintético que mistura duas câmeras virtuais, um segmento de
transição e detecções ausentes, e depois executa calibração → análise →
renderização de ponta a ponta. Os valores em `demo/synthetic_recovery.json`
são comparados com a verdade de referência sintética, então não indicam a
exatidão em vídeo real.

## Usando seu próprio vídeo

1. **Detecções (`tracks.json`)**: uma linha por quadro decodificado, com o PTS
   real desse quadro (segundos), o id do segmento de câmera (`null` para
   segmentos de transição e close-up), as coordenadas em pixels da peteca
   (`null` quando ausente) e caixas de jogadores opcionais. `frame_id` deve
   corresponder à ordem de decodificação. Veja
   [docs/schemas.md](schemas.md) para o formato.
   A v0.1 não tem detector. Você pode executar por conta própria o TrackNetV3
   (MIT) ou o Ultralytics YOLO (AGPL-3.0) e converter os resultados, mas
   nenhum script de conversão está incluído. Nenhum peso de modelo é baixado.
2. **Entrada de calibração**: para cada segmento de câmera, marque em pixels
   quatro ou mais interseções de linhas da quadra (`fit`), algumas interseções
   para validação (`heldout`) e o topo dos dois postes da rede (altura
   1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Verifique primeiro `heldout_summary` (o erro nos pontos não usados no
   ajuste) e `net_anchor_sensitivity` (quanto a altura se desloca quando os
   postes da rede são movidos pelo erro em pixels informado). A homografia do
   piso é usada apenas para pontos do piso (Z=0) e nunca para a peteca no ar.
3. **Anotações de revisão (`review.json`)**: informe o instante do contato com
   a raquete (`time_s`), o intervalo de revisão que o contém
   (`time_bracket_s`), o pixel do contato e uma estimativa de altura. O
   instante do contato é o segundo 0 do voo. Uma primeira detecção tardia não
   muda o segundo 0.
   Apenas o último contato de um segmento pode ter uma condição final: uma
   `landing_region` (a área e o intervalo de tempo em que a peteca chega ao
   piso) ou `open` (até a última observação do segmento, ou até o `until_s`
   revisado). Qualquer outro voo termina no contato seguinte e não é forçado a
   chegar ao piso. A v0.1 não corrige os instantes de contato
   automaticamente, então corrija-os você mesmo olhando os quadros.
4. **Análise e renderização**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   O comentário `# 한 번에:` significa "tudo em uma etapa:"; `run` faz a
   análise e a renderização juntas.

   A ferramenta para com código de saída 2 se o PTS retroceder, se o mesmo
   segmento de câmera reaparecer após uma lacuna, se um contato estiver fora
   do seu segmento de câmera ou do intervalo de revisão, ou se o PTS do vídeo
   e o PTS das trilhas forem diferentes. Ela nunca corrige a entrada
   silenciosamente.

## Lendo os resultados

- Círculo verde: as coordenadas de detecção de entrada como foram fornecidas.
  Quadros sem detecção ficam vazios.
- Círculo/pontos laranja: o modelo físico condicional. Desenhado apenas dentro
  do mesmo segmento de câmera e do mesmo voo.
- Caixa azul tracejada: a região de queda indicada por uma pessoa. A marca ×
  é o ponto de queda do modelo ajustado com essa região como condição, não uma
  coordenada medida.
- A velocidade é a velocidade inicial do modelo arredondada para 5 km/h.
- Para um voo devolvido, o ponto "onde teria caído se não fosse devolvido" é
  registrado apenas no JSON (`unreturned_floor_crossing_prediction`, uma
  previsão contrafactual).
- Se o original tiver áudio, os pacotes de áudio são copiados como estão, sem
  recodificação, então o atraso inicial e as lacunas do áudio original são
  preservados. Se o áudio não puder ser copiado para MP4 ou se sua
  temporização mudar, a renderização falha. O resultado da decodificação do
  arquivo de saída até o fim para verificação é gravado em
  `render_report.json`.
- Arquivos existentes nunca são sobrescritos. A ferramenta para se um arquivo
  de saída já existir ou for o mesmo arquivo que o vídeo original, e a
  renderização grava em um arquivo temporário que só é movido para o nome
  final após a verificação.

## Licença

Somente GNU AGPL-3.0. Veja [LICENSE](../LICENSE) e [NOTICE.md](../NOTICE.md).
