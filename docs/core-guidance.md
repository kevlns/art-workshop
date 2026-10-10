# 核心冻结指导规则

权威规则为 rules/core-guidance.json。风格分析请求、推荐校验与冻结来源使用同一份规则。此文解释审查方法，不另造第二份可修改的风格提示词。

## 各层拥有的内容

| 层 | 负责内容 | 审查重点 |
|---|---|---|
| core | 媒介、形体、渲染、光照、色彩关系、题材表面处理 | 是否跨主体复用，正负向是否一致 |
| profile | 背景、构图许可、留白、文字、外框、投影、设计基准 | 是否适合目标资产与设计尺寸 |
| generate item | 实体、数量、身份色、动作、关系、效果、单张构图 | 是否可从 mustRead 和实体字段确认内容 |
| execution/backend | 模型、size、perValue、seed、水印、扩写、workflow | 是否符合当前模式与环境 |
| edit item | 底图、changes、preserve | 修改与保留是否冲突，原图是否正确 |

## 报告到冻结的检查

1. 一条规则表达一个可执行判断，去掉同义重复和无助于生成的修辞。
2. 视觉术语明确；强度、数量、颜色、范围有明确字段，避免互斥渲染机制。
3. 推荐、冻结、正向提示词、负向约束与验收从同一结构生成，前后一致。
4. 核心只拥有视觉语言；具体主体、布局、背景、模型、尺寸不得混入核心。
5. 一个事实只有一个权威字段；不再追加另一段冻结 styleBlock 覆盖结构化核心。
6. domains 规则明确作用于实体类别；表面科幻处理不等于给所有主体套同一结构。
7. observations 保留 source、scope、feature、evidence、confidence；建议进入 recommendation，推断和未知进入 uncertainties。
8. 不把参考图偶然的颜色、数量、背景和布局当成全局要求；不同主体允许保留自己的身份色。
9. 冻结来源、身份与哈希可追溯；旧核心不能原地覆写，任务明确选择新核心。

style validate 检查结构、枚举、已定义语义矛盾、语言长度和常见职责越界。它不能穷尽自然语言矛盾或替代图像审查。未解决 conflicts/uncertainties 阻止冻结；处理后重新验证。

```powershell
v-cli art style validate --project P --report projects/P/reports/style.json
# 已有用户采用报告的依据后执行。
v-cli art style freeze --project P --report projects/P/reports/style.json --note "采用已审阅的推荐风格"
v-cli art style show --project P --core style
```

freeze 会写核心并更新 project.cores；没有 defaultCore 时可设为新核心。需要第二套风格时使用新的报告/核心 ID，不复制冻结文件改身份。

## 生图时的核心检查

文生图核心选择顺序为显式 --core、任务 core、工程 defaultCore。显式指定与任务 core 冲突时先修改任务绑定；没有明确选择时不跨工程回退。

图编辑默认保留原图风格，不读取 defaultCore。明确绑定目标 core 时，style 的修改或保留由核心负责，任务不再重复声明。

换远程/本地后端只改变执行能力，不自动改核心或需求。同一提示词在不同模型上的表现可能不同，必须按 content/style/asset 分别审查。

## 风格变化的对照

新风格先生成新报告和核心，再对相同任务编译两个计划，核对 compare 与 dry，固定可控 seed，在授权范围内做少量图像对照。compare 只对比计划，不评价风格一致性；同 seed 也不保证跨模型、版本或设备逐像素复现。

```powershell
v-cli art compare .cache/old-plan.json .cache/new-plan.json
v-cli art check RUN --out .cache/review.json
```

只有产物完整、生成成功且 content/style/asset 全部 pass 才可 select。规则检查、模型成功返回或生成缩略图都不能单独作为生产资产验收。
## 推荐核心结构示例

以下是报告 recommendation 的合法结构示例，与 data-formats.md 的 energy 类别配套。它不是已冻结文件，仍需依据实际证据产生报告、审阅并 freeze；不要人为补 coreHash 绕过流程。

```json
{
  "medium": "illustration",
  "shape": { "contour": "rounded", "detail": "low" },
  "render": {
    "shading": "cel",
    "toneSteps": 2,
    "outline": { "enabled": true, "color": "#34445C", "width": 0.004 },
    "highlights": "hard-edge",
    "finish": "matte",
    "texture": "none"
  },
  "lighting": { "direction": "top-front", "contrast": "medium" },
  "color": { "preserveIdentity": true, "shadowShift": "cool" },
  "domains": {
    "energy": { "treatment": "emissive", "signature": "用简洁硬边高光表达能量表面。" }
  }
}
```

medium 可为 illustration/painting/pixel-art/photography；轮廓为 rounded/angular/mixed，细节为 low/medium/high。shading 可为 cel/flat/smooth/painterly/pixel；cel 至少两阶、不能有软高光或可见纹理，flat 一阶，smooth/painterly 的 toneSteps 为 null，pixel-art 应配 pixel，photography 应配 smooth 且无描边。其他组合和长度限制由 style validate 核对。

描边 width 是画幅宽度比 0～0.03，不是像素值；关闭描边时 width=0。domain treatment 可为 organic/hard-surface/emissive/structure/symbol，signature 只描述表面和形态处理，不声明本张主体、数量或背景。
