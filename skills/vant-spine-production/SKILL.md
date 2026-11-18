---
name: vant-spine-production
description: "制作或调整 2D Spine 角色与动画时按需查阅。适用于从需求设计原型、高清拆件补绘、绑骨蒙皮、对照修形、动作与转场、运行时预览，以及 Unity 或 Web 运行资源的质量与开销调优。"
---

# 2D Spine 制作指南

**动作命名。** 新制动作统一使用 `<语义类别>_<三位变体号>`。类别使用小写英文 snake_case，每类从 `001` 起，即使只有一个动作也保留编号。已有动作的编号保持稳定。交付时同时校验骨架和同目录的 `animations.json`，详见[命名与索引](references/rig-motion.md#命名与索引)。

从用户要看到的变化和手里的材料入手。已有定稿就沿用定稿，已有骨架就保留可用的绑定和动作。只读与当前问题有关的小节。交接时留下本次产物、采用的基准图，以及在什么尺寸和运行端看过效果。

| 当前问题 | 查阅 |
| --- | --- |
| 只有一句角色设想，或要把已定稿的角色拆成可动部件 | [原型与拆件](references/art-parts.md#原型设计)、[拆分粒度](references/art-parts.md#拆分粒度) |
| 放大后细节糊、转腕露洞、换表情时整张脸变了 | [高清重绘与补绘](references/art-parts.md#高清重绘与补绘) |
| 原画很像，进引擎后脸宽了、手袖有缝或姿势不对 | [绑定与蒙皮](references/rig-motion.md#绑定与蒙皮)、[对照修形](references/rig-motion.md#对照修形) |
| 想做一个动作、改善循环或检查两段动作如何衔接 | [动作与转场](references/rig-motion.md#动作与转场)、[运行时预览](references/rig-motion.md#运行时预览) |
| 要交给程序、接入 Vanter，或运行后模糊、掉帧、包太大 | [导出、运行验收与成本取舍](references/delivery.md) |
| 需要选择制作工具或读取输入契约 | [工具入口](references/delivery.md#工具入口)、[图像处理备选](references/art-parts.md#图像处理备选) |

**制作入口。** 在 Vant 中从会话提供的 `DSH_VANT_CLI` 运行 `art spine`。配方字段见 `art spine describe`。原画定位与蒙版回贴用 `parts`；骨架、权重、时间线和运行图集用 `build`；留存指定时刻的 PNG 和对照图 用 `capture`。这些命令可在独立工作目录执行。

**在 Vant 中预览。** 桌面提供 `vant_spine_preview` 时，用项目骨架相对路径或已登记资产 ID 打开浮窗，可指定初始动作。需要逐帧、查看绑定或对照上一版时，打开美术工坊标题栏右侧的 Spine 页签。工作台以外使用目标版本的 Spine 播放器。在 Vant 中确认某个项目导出版本入美术仓时，接续工作台的 `vant-asset-intake` 指南。
