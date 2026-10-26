# 궤적 물리

카메라 한 대는 셔틀콕을 하나의 픽셀로 봅니다. 그 픽셀을 지나는 시선 위의 모든 점은 가깝든 멀든 같은 픽셀에 찍히므로, 프레임 하나로는 깊이를 알 수 없습니다. 이 페이지는 `shuttle-replay`가 물리와 검토된 제약을 더해 픽셀의 연속을 어떻게 3D 비행으로 바꾸는지, 그리고 그 결과가 무엇을 의미하고 무엇을 의미하지 않는지 설명합니다.

## 역문제

각 검출을 카메라에서 나가는 광선으로 생각해 보세요. 비행은 올바른 시각에 모든 광선 가까이를 지나야 하는 곡선입니다. 그런 곡선은 여러 개가 있을 수 있습니다. 느리고 가까운 비행과 빠르고 먼 비행이 비슷한 픽셀 궤적을 만들 수 있습니다. 이 문제는 해가 하나로 정해지지 않습니다(과소결정). 도구는 다음 조건을 요구해 곡선 하나를 고릅니다.

- 중력과 공기 저항(아래 모델)을 따를 것,
- 검토된 타구 시각에 검토된 타구 위치와 높이 근처에서 시작할 것,
- 다음 검토된 타구 시점이나 검토된 착지 영역 쪽으로 부드럽게 당겨지거나, 관측 구간 끝에서 멈출 것(끝점 잔차는 페널티이며 엄격한 수락 요건이 아닙니다), 그리고
- 바닥 위에 머물고, 네트를 넘어야 할 때는 네트를 넘을 것.

따라서 피팅된 3D 경로는 **조건부 모델**입니다. 보정과 검토가 주어졌을 때 가장 일관된 곡선이며 측정값이 아닙니다([`analysis.py` 모듈 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## 비행 모델

상태는 미터 단위 위치 `r = (x, y, z)`와 m/s 단위 속도 `v`입니다. 운동 방정식은 다음과 같습니다([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)).

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

공기 저항은 운동 반대 방향을 향하고 속도의 제곱에 비례해 커집니다. `k`를 이해하는 유용한 방법이 있습니다. 똑바로 떨어지는 셔틀콕은 공기 저항이 중력과 같아지는 종단 속도 `sqrt(g / k)`에서 더 이상 가속하지 않습니다. 기본 사전값 `k = 0.18 1/m`이면 약 7.4 m/s입니다. 그래서 빠르게 맞은 셔틀콕은 급격히 느려집니다. 모델에는 회전, 텀블링, 바람이 없습니다.

피팅되는 일곱 파라미터는 **비행 시각 0**에서의 `[x, y, z, vx, vy, vz, k]`입니다. 비행 시각 0은 첫 검출 시각이 아니라 검토된 타구 시각입니다([`physics.py` 모듈 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)). 라켓이나 선수가 셔틀콕을 가리기 때문에 검출은 타구 후 몇 프레임 뒤에 시작하는 경우가 많습니다. 그 프레임들은 타구 시점으로부터의 오프셋으로 측정되므로 첫 검출이 늦어도 비행 시작점은 움직이지 않습니다(`first_observation_delay_s`가 그 간격을 보고합니다).

## 수치 적분

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)는 SciPy `solve_ivp`(기본값인 명시적 Runge-Kutta 방법)로 `t = 0`부터 `rtol=1e-7`, `atol=1e-8`, `max_step=0.02`초, 조밀 출력(dense output) 설정으로 방정식을 적분한 뒤 요청된 시각의 위치를 계산합니다. 유한하지 않은 시각과 `-1e-9` s보다 작은 시각은 거부하며, 그보다 큰 아주 작은 음수 값은 0으로 고정합니다. 솔버 허용 오차는 수치 적분 오차를 조절할 뿐이며, 복원 정확도의 한계가 아닙니다. [`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)은 `z`에 대한 이벤트 함수(하강 방향만, 종료 이벤트)를 사용하며, 더 엄격한 허용 오차(`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`)로 10 s 범위를 계산합니다.

## 무엇을 최소화하는가

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)는 잔차 벡터 하나를 만듭니다. 각 항목은 차이를 스케일로 나눈 값이므로 "1"은 "예상 오차 하나만큼"을 뜻합니다.

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T`는 비행 시간입니다. 타구 사전값은 [`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54)에서 나옵니다. 타구 시점에 `image_px`가 있으면 그 픽셀을 지나는 광선을 검토된 `height_m` 높이의 평면과 교차시키고, 없으면 `court_xy_m`과 `height_m`을 그대로 사용합니다. 시그마는 각 타구 시점의 `xy_sigma_m`과 `height_sigma_m`에서 오며, 없으면 위에 표시된 기본값을 씁니다.

네트 항에서 `h_net`은 41개 샘플 경로가 처음으로 `Y = 6.70`을 지나는 지점의 보간된 높이입니다. 경로가 한 번도 지나지 않으면 `h_net`은 0으로 계산됩니다. 이 항은 소스에 쓰인 대로 1.55 m(기둥 높이)를 사용하고, 아래의 수락 게이트는 1.524 m(네트 중앙)를 사용합니다.

SciPy `least_squares`는 `loss="soft_l1"`과 `f_scale=1.5`로 합을 최소화하므로, 나쁜 검출 몇 개는 일반 제곱합일 때보다 덜 끌어당깁니다. 시작점은 여섯 개입니다. 끝 목표를 향한 탄도 추정값에 추가 상향 속도 `1.0` 또는 `3.0` m/s를 더한 것과, `k`가 `0.1, 0.2, 0.35`인 경우를 조합합니다. 비용이 가장 낮은 결과가 선택됩니다. 경계는 탐색을 물리적인 범위로 유지합니다([소스](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)).

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

일곱 개의 상태/공기 저항 파라미터는 경계까지의 거리가 허용 범위의 0.1% 미만이면 `parameters_at_bound`에 표시됩니다([소스](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)). 표시된 피팅은 거부됩니다. 착지 시각은 이 진단에 포함되지 않습니다. 통과했다고 해서 식별 가능성, 유일성, 또는 사전값 영향이 없음이 입증되지는 않습니다.

## 비행이 끝나는 방식

비행은 카메라 구간마다 타구 시점을 시간 순서로 따라 만들어집니다([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)).

- **`intercepted_by_next_contact`**: 같은 구간에 다른 타구 시점이 이어집니다. 비행 시간은 두 타구 시점 사이의 시간이고, 끝점은 다음 타구 시점의 사전값 쪽으로 당겨집니다. 두 타구 사전값이 네트의 서로 다른 쪽에 있으면 네트 통과가 필요합니다.
- **`landing_region`**: 구간의 마지막 타구 시점에 검토된 착지 종료가 있습니다. 타구 시점과 착지 끝점 잔차가 피팅을 검토된 끝점 쪽으로 부드럽게 당깁니다. 착지 시각은 검토된 구간(bracket)으로 제한되지만, 끝점 높이와 영역 포함 여부는 엄격한 수락 요건이 아닙니다. `landing.within_region`은 1 mm 허용치로 포함 여부를 보고할 뿐 수락을 제어하지 않습니다. 시작점과 영역 중심이 네트의 서로 다른 쪽에 있으면 네트 통과가 필요합니다.
- **`open_segment_end`**: 그 밖의 모든 경우. 구간은 세그먼트 끝이나 `until_s`에서 끝나고, 피팅 시간은 마지막 관측 오프셋이며, 네트 통과는 필요하지 않습니다.

구간 안의 검출이 `min_observations`(기본값 4)개보다 적으면 피팅 없이 `status: "insufficient_observations"`가 됩니다.

## 수락 게이트

피팅 후 경로를 201개 점으로 샘플링해 [`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)로 검사합니다. `floor_ok`는 가장 낮은 점이 -0.02 m 이상이어야 합니다. `net_ok`는 통과가 필요했던 경우 통과가 있어야 하며, 통과가 예상되었든 아니든 인접 샘플 사이에서 검출된 **모든** 통과가 1.524 m 이상이어야 합니다. 비행은 최적화기가 성공을 보고하고, 두 게이트가 모두 통과하고, 재투영 RMS가 `max_accept_rms_px`(기본값 8.0 px) 이하이고, 일곱 개의 상태/공기 저항 파라미터 중 어느 것도 표시되지 않았을 때만 수락됩니다. 거부된 비행은 검사용으로 파라미터를 유지하지만 모델 계층으로 그려지지 않습니다.

## 속도와 반사실적 착지

`model_speed_km_h`는 모델의 초기 속도인 `|v(0)| * 3.6`이며, `model_speed_coarse_km_h`는 표시용으로 이를 가장 가까운 5 km/h 단위로 반올림한 값입니다. 레이더 측정값이 아닙니다.

착지 영역으로 끝나지 않는 비행에서 모델이 비행이 끝난 뒤 바닥에 닿게 된다면, 분석은 `kind: "counterfactual_if_unreturned"`와 `observed: false`를 가진 `unreturned_floor_crossing_prediction`을 추가합니다. 이는 셔틀콕이 실제로 간 곳이 아니라 "아무도 받아치지 않았다면 이 모델은 어디에 떨어졌을까"에 대한 답입니다. 착지 비행에서 `landing.xy_m`은 사용자가 지정한 영역 쪽으로 부드럽게 당겨진 모델 끝점이며(영역 안에 있다는 보장은 없음), `exact_coordinate_measured`는 항상 `false`입니다.

관련 문서: `P`는 [카메라 보정](camera-calibration.md), 관측 구간은 [관측과 타이밍](observations-timing.md), `fit`과 `gates` 해석은 [검증과 한계](validation-limits.md)를 참고하세요.
