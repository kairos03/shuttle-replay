# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**将本地羽毛球视频、你提供的检测结果和你的人工审核转换为并排显示的球场回放。完全离线。**

`shuttle-replay` 根据你审核过的球场点标定摄像机，将带有重力与二次空气阻力的飞行模型拟合到你提供的 2D 羽毛球检测结果上，并渲染出一个 MP4：源视频与俯视球场图并排显示。

它是一个研究与审核工具，而不是司线判罚系统、击球分类器、羽毛球检测器或实测的 3D 测速仪：

- **检测结果由你提供。** 本工具不附带任何羽毛球或球员检测器，也不会下载任何模型权重。
- **审核由你完成。** 击球接触、落点区域和标定点都由人工审核；不会自动发现或修复任何内容。
- **3D 是条件性的，而非实测。** 每一个 3D 位置和速度都是物理模型的输出，取决于你的标定和标注。本工具没有学习得到的深度，较低的重投影误差也不能证明 3D 精度。

```{image} assets/demo.gif
:alt: 合成演示回放：源视频画面与俯视球场图并排显示
:width: 90%
```

*由 `shuttle-replay demo` 生成的合成演示。不代表真实场景下的精度。*

```{toctree}
:maxdepth: 2
:caption: 指南

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: 语言

languages
```

```{toctree}
:maxdepth: 1
:caption: 项目

development
license
```
