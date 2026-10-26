# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**로컬 배드민턴 영상, 직접 준비한 검출 결과, 직접 한 검토를 나란히 보는 코트 리플레이로 만듭니다. 오프라인으로 동작합니다.**

`shuttle-replay`는 검토한 코트 점으로 카메라를 보정하고, 사용자가 제공한 2D 셔틀콕 검출 결과에 중력과 2차 공기 저항을 포함한 비행 모델을 맞추고, 원본 영상과 위에서 본 코트를 나란히 놓은 MP4를 렌더링합니다.

이 도구는 연구와 검토를 위한 도구입니다. 라인 판정 시스템, 샷 분류기, 셔틀콕 검출기, 실측 3D 스피드건이 아닙니다.

- **검출 결과는 사용자가 제공합니다.** 셔틀콕이나 선수 검출기는 포함되어 있지 않으며 모델 가중치도 내려받지 않습니다.
- **검토는 사용자가 합니다.** 타구 시점, 착지 영역, 보정 점은 사람이 검토합니다. 자동으로 찾거나 고치는 것은 없습니다.
- **3D는 조건부 값이며 실측값이 아닙니다.** 모든 3D 위치와 속도는 보정과 주석에 따라 달라지는 물리 모델의 출력입니다. 학습된 깊이 추정은 없으며, 재투영 오차가 작다고 해서 3D 정확도가 증명되지는 않습니다.

```{image} assets/demo.gif
:alt: 합성 데모 리플레이, 원본 화면과 위에서 본 코트를 나란히 표시
:width: 90%
```

*`shuttle-replay demo`로 생성한 합성 데모입니다. 실제 환경에서의 정확도를 나타내지 않습니다.*

```{toctree}
:maxdepth: 2
:caption: 가이드

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: 기술 설명

technology
camera-calibration
trajectory-physics
observations-timing
rendering-safety
validation-limits
```

```{toctree}
:maxdepth: 1
:caption: 언어

languages
```

```{toctree}
:maxdepth: 1
:caption: 프로젝트

development
license
```
