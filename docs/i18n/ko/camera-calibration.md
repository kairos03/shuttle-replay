# 카메라 보정

보정은 한 가지 질문에 답합니다. 코트 위의 한 점(미터 단위)이 카메라 화면의 어느 픽셀에 보이는가? `shuttle-replay`는 사용자가 손으로 찾은 점들로부터 추정한 선형 핀홀 카메라로 이 질문에 답합니다. 이 페이지는 좌표계, 도구가 계산하는 두 행렬, 정확한 알고리즘, 그리고 보고되는 오차의 의미를 설명합니다.

## 두 좌표계

**이미지 좌표** `(u, v)`는 원본 영상의 픽셀입니다. `u`는 오른쪽으로, `v`는 아래쪽으로 커집니다.

**월드 좌표** `(X, Y, Z)`는 BWF 코트 규격으로 고정된 코트 좌표계의 미터 단위 값입니다([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)).

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

라인 폭은 40 mm이며 보정 점은 **라인 중심**을 사용합니다. 바깥 라인은 X = 0.02 / 6.08, Y = 0.02 / 13.38, 단식 사이드라인은 X = 0.48 / 5.62, 쇼트 서비스 라인은 Y = 4.70 / 8.70, 복식 롱 서비스 라인은 Y = 0.78 / 12.62, 센터 라인은 X = 3.05입니다([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)). 중심이 필요한 곳에 바깥 모서리를 입력하면 그 점이 2 cm 어긋납니다.

## 핀홀 투영

핀홀 카메라는 3x4 행렬 `P`로 월드 점을 픽셀로 옮깁니다.

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

`c`로 나누는 것이 원근입니다. 먼 물체는 작게 보입니다. `P`는 카메라의 위치와 회전(외부 파라미터)을 초점 거리와 이미지 중심(내부 파라미터)과 결합합니다. 이 프로젝트는 `P`를 이 부분들로 나누지 않습니다. 대신 `P`를 하나의 행렬로 사용합니다([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)). 카메라 중심 `C`는 `P * [C, 1] = 0`을 만족하는 유일한 점이므로 `C = -inverse(P[:, :3]) * P[:, 3]`입니다([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## 1단계: 바닥 호모그래피 (Z = 0 전용)

바닥 위의 점은 `Z = 0`이므로 `P`의 세 번째 열에 0이 곱해져 사라집니다.

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

3x3 행렬 `H = [p1 p2 p4]`가 **호모그래피**입니다. 이 행렬은 [`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78)에서 정규화된 직접 선형 변환(DLT)으로 `role: "fit"` 지면 점들로부터 피팅됩니다.

1. 각 점 집합을 무게중심으로 평행 이동하고, 무게중심으로부터의 평균 거리가 `sqrt(2)`가 되도록 크기를 조정합니다([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)). 픽셀 값은 수백 단위이고 미터 값은 한 자리 수일 때 선형 시스템의 조건을 좋게 유지하기 위해서입니다.
2. 대응점 하나마다 선형 시스템 `A h = 0`에 두 행이 추가됩니다.
3. `h`는 가장 작은 특이값에 해당하는 `A`의 오른쪽 특이 벡터입니다. 정규화를 되돌리고 `H[2, 2] = 1`이 되도록 `H`의 크기를 맞춥니다.

퇴화된 입력은 나쁜 행렬을 만들지 않고 `CalibrationError`로 거부됩니다. 피팅 점이 4개 미만인 경우, 중복 좌표, 한 직선 위에 놓인 점 집합, 정확히 4개 중 3개가 한 직선 위에 있는 경우, 두 번째로 작은 특이값이 가장 큰 값의 `1e-9`배 미만인 경우(해가 유일하지 않음), 조건수가 `1e12`를 넘는 경우입니다([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

이 피팅은 모든 피팅 점에 대한 대수적 잔차를 최소화하는 정규화 DLT이며, 비선형 재투영 정밀화는 하지 않습니다. 이상치 제거(RANSAC 없음)도, 렌즈 왜곡 모델도 없습니다. 잘못 입력한 점 하나나 강한 배럴 왜곡이 피팅 전체를 끌어당깁니다.

`H`는 바닥만 설명합니다. 출력의 `H_scope`가 이를 명시합니다([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)). 셔틀콕 픽셀을 `H`로 역투영하면 "이 픽셀이 바닥 위에 있다면 어디일까"에 대한 답이 나오며, 공중에 있는 물체에는 틀린 답입니다.

## 2단계: 네트 앵커로 구하는 수직 열

바닥 점은 높이에 곱해지는 열인 `p3`에 대해 아무것도 알려 주지 않습니다. 이를 구하려면 바닥 위에 있지 않으면서 높이를 아는 점이 필요합니다. 보통 `Z = 1.55`인 두 네트 기둥의 꼭대기입니다. `(u, v)`에 보이는 `(X, Y, Z)` 앵커에 대해 `q = H * [X, Y, 1]`로 두면 투영 조건이 `p3`에 대해 선형이 됩니다.

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)는 이 행들을 쌓고, 랭크 3을 요구하고, 최소제곱으로 풀어 `P = [h1 h2 p3 h3]`을 조립합니다. 여기서 `h1`, `h2`, `h3`은 `H`의 열입니다. 미지수가 3개이고 앵커당 두 행이므로 앵커 두 개는 방정식 네 개를 주어 거의 정확히 결정됩니다. 그래서 앵커 잔차(`net_anchor_residuals_px`)가 작아도 증명되는 것은 거의 없습니다. 앵커는 높은 위치(`Z > 0.1 m`)에 있어야 하며 최소 두 개가 필요합니다.

마지막으로 [`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)는 중심이 바닥 위에 있지 않은 카메라, 또는 일부 코트 점은 앞에, 다른 점은 뒤에 두게 되는 카메라를 거부합니다.

## 피팅 점과 홀드아웃 점

모든 지면 점에는 역할이 있습니다([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)).

- `fit` 점은 `H`를 만듭니다. 이 점들의 잔차(`fit_ground_residuals`)는 학습 오차이며 작을 것으로 예상됩니다.
- `heldout` 점은 피팅에 전혀 사용되지 않습니다. 최소 하나가 필요합니다. `heldout_ground_errors`는 점마다 `error_px`(월드 점에 `H`를 적용해 사용자의 픽셀과 비교)와 `error_m`(사용자의 픽셀에 역 `H`를 적용해 월드 점과 비교)를 보고합니다. `heldout_summary`는 두 값의 개수, 평균, 최댓값을 제공합니다.

개념적인 예: 바깥 모서리 네 개를 `fit`으로, 서비스 라인 교차점 두 개를 `heldout`으로 둡니다. 홀드아웃 오차가 피팅 잔차보다 훨씬 크다면 점의 라벨이 잘못되었거나, 라인 중심 대신 가장자리를 클릭했거나, 렌즈가 라인을 휘게 하는 것입니다. 홀드아웃 오차는 바닥 매핑만 확인하며, 높이에 대해서는 아무것도 말해 주지 않습니다.

## 신뢰 구간이 아닌 민감도

높이는 거의 전적으로 앵커에 달려 있습니다. [`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)는 네트 센터 라인 위 3 m인 기준점 `(3.05, 6.70, 3.0)`을 잡아 `P`로 투영합니다. 그런 다음 각 앵커와 `u`, `v` 각각에 대해 앵커 픽셀을 `+uncertainty_px`와 `-uncertainty_px`(기본값 3.0)만큼 옮기고, `P`를 다시 풀고, 같은 기준 픽셀을 지나는 광선을 네트 평면 `Y = 6.70`과 교차시킵니다. `max_vertical_shift_m`은 높이 변화 중 가장 큰 값입니다. 섭동 때문에 풀이가 실패하면 변화량은 무한대로 보고됩니다.

이는 한 점에 대해 한 번에 하나씩 바꿔 본 최악의 경우입니다. 통계적 신뢰 구간이 아니며, 여러 앵커의 오차를 합치지 않고, 지면 점 오차도 포함하지 않습니다.

## 사용자가 두는 가정

- `segment_id`마다 고정된 카메라 하나. 카메라가 움직이거나 줌을 하면 새 구간이 필요합니다.
- 직선은 이미지에서도 직선으로 유지됩니다(렌즈 왜곡 없음).
- 앵커는 입력한 높이를 가집니다. 기둥 꼭대기 1.55 m와 네트 중앙 1.524 m는 서로 다른 높이입니다.
- 지면 평면은 셔틀콕이 아닙니다. `H`는 바닥 위치를 주며, 셔틀콕의 깊이는 [궤적 물리](trajectory-physics.md)에서 설명하는 물리 피팅으로부터만 나옵니다.

전체 입력과 출력 필드는 [스키마](schemas.md)를, 오차를 비행 진단과 함께 읽는 방법은 [검증과 한계](validation-limits.md)를 참고하세요.
