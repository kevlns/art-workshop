# art 工程与输入结构

所有工程数据放在配置的 workspace。工具只随包发布规则、指南和内置工作流，不随包发布用户工程、模型权重或图片。

## 工程布局

```text
workspace/
  projects/P/
    project.json
    briefs/style.json
    reports/style.json
    cores/style.json
    profiles/icon.json
    jobs/generate.json
    jobs/edit.json
```

project.json 的最小结构示例：

```json
{
  "id": "demo",
  "name": "示例工程",
  "analysisModel": "qwen3-vl-plus",
  "execution": { "size": "1024*1024", "perValue": 1, "promptExtend": false, "watermark": false },
  "cores": [],
  "defaultCore": null
}
```

实际 ID（示例 demo）必须与目录名一致，使用小写字母、数字、连字符。新工程先分析并冻结自己的核心，不能复制冻结文件修改身份。cores 可包含多核心，defaultCore 为成员 ID 或 null；没有默认值时明确选核心。refsDir 是可选工程参考目录。

## 风格分析输入

```json
{
  "project": "demo",
  "id": "style",
  "description": "圆润低细节的科幻插画，用硬边色块表达明暗。",
  "refs": [
    { "path": "style/reference.png", "scope": "render", "note": "只观察明暗和描边，不继承主体或背景。" }
  ],
  "constraints": ["核心应适用于多个主体，主体身份色由任务声明。"]
}
```

refs 可为空；有参考时 path 指向可读图片，scope 仅允许 style/palette/shape/render，note 描述观察边界。style、palette、subject、composition、material、text、pose 分类目录仅帮助整理，不自动绑定图片；分析 scope 与目录名不是同一组枚举。

报告包含 observations、recommendation、conflicts、uncertainties 和 provenance。recommendation 的完整合法结构由核心规则和分析请求提供；用 style validate 检查后审阅，解决冲突和不确定项，再经用户采用 freeze。冻结文件带身份与哈希，不手写或原地修改。

## 文生图任务

任务顶层允许 project/kind/core/profile/execution/items。以下示例假定已存在工程核心 style 和 profile icon；不是无需准备即可运行的工程。

```json
{
  "project": "demo",
  "kind": "generate",
  "core": "style",
  "profile": "icon",
  "items": [
    {
      "id": "energy",
      "seed": 1000,
      "intent": "一颗青色能量球，两个细轨道前后环绕。",
      "entities": [
        { "id": "ball", "kind": "energy", "appearance": "能量球", "color": "青色", "role": "primary", "count": 1 }
      ],
      "effects": [
        { "id": "orbit", "kind": "细轨道", "target": "ball", "color": "亮青色", "relation": "前后穿插环绕", "count": 2 }
      ],
      "composition": { "focalTarget": "ball" },
      "mustRead": ["一个青色主体", "两个轨道环绕关系"],
      "variants": [{ "id": "base" }]
    }
  ]
}
```

entities 的 kind 必须在核心 domains 中有规则。id 不重复，角色为 primary/support，数量 1～100。效果 target 和 relations.from/to 必须指向声明的对象。身份色、数量、动作和关系属于需求，不放进全局风格。variants 只允许 id/composition/seed，不能通过候选偷偷改变实体语义。

profile 定义 constraints、defaults、allowedOverrides、presets、checks 和可选 design。构图字段只能在允许的枚举或范围内变化；焦点必须存在。核心选择依次为显式 --core、任务 core、工程 defaultCore；显式选择与任务绑定冲突时报错。

背景默认纯白。其他纯色用 {type:solid,color:#RRGGBB}；渐变声明 type=gradient/from/to；场景声明 type=scene/description 且 profile 允许 scene。默认留白、文字、外框、投影等由 profile 决定，plan 检查覆盖是否合法。

## 图编辑任务

```json
{
  "project": "demo",
  "kind": "edit",
  "core": null,
  "items": [
    {
      "id": "energy-white",
      "source": "output/previous-run/energy--base.png",
      "changes": [{ "target": "background", "value": { "type": "solid", "color": "#FFFFFF" } }],
      "preserve": [
        { "target": "content", "instruction": "保留能量球和两条轨道。" },
        { "target": "style", "instruction": "保留主体渲染风格。" }
      ],
      "mustRead": ["纯白背景", "主体与轨道完整"],
      "seed": 1000
    }
  ]
}
```

source 基于 workspace，而不是 output；建议写绝对路径以避免目录误解。changes 非空，preserve 为数组；target 可为 background/style/shape/color/composition/content/detail/text。同一 target 不能重复或同时修改和保留。background 修改用 value，其余范围用 instruction。

编辑不读取工程默认核心；显式选择或任务绑定核心才改变目标风格，且禁止再声明 style 的修改或保留。source 哈希进入 plan；更换底图后重新编译。当前接口每项仅一个 source，本地适配器仅上传一张底图。

## UI 设计尺寸

设计基准属于 profile，不属于冻结核心。profile 可加入：

```json
{ "design": { "resolution": { "width": 1920, "height": 1080 }, "outputScale": 2 } }
```

任务 item 可加入独立控件尺寸：

```json
{ "design": { "width": 240, "height": 80, "outputScale": 4 } }
```

该控件输出 960*320；同一任务其他控件可有不同尺寸。没有 item.design 时使用 profile 的整幅设计基准。倍率为 1～4 整数，控件每边为正整数且不得超过基准；未写倍率则继承 profile。每边实际输出必须在 256～4096 内，本地还要为 32 的倍数。越界报错，不自动拉伸、补边或调整倍率。

使用 design 时禁止 job.execution.size；设计换算覆盖工程及全局 size 默认值，其他执行参数保持优先级。每项 plan 保存 design 和 execution；预演、执行、哈希和验收共用这些参数。设计尺寸控制请求画布，不保证控件边缘精确，也不自动切图、生成九宫格或透明底。

## 输出与审查

运行目录为 output/<job>-<taskId>，manifest 保存 plan 快照、输入与输出哈希、请求、文件、状态、失败诊断、验收及选择。图片名基于 itemId--variantId，多张带序号。不要将已生成图片、失败记录或 review 当作冻结核心。

compare 对比计划的核心哈希、执行与单体变化；不对图片打分。check 导出每图的人工 content/style/asset 检查要求；select 记录通过审查的唯一产物，不自动复制或导入游戏工程。
## 完整 profile 示例

以下保存为 projects/demo/profiles/icon.json，与前面的任务配套。可以从这一份最小规格扩展允许的构图；不要直接添加不在 allowedOverrides 中的值。

```json
{
  "project": "demo",
  "id": "icon",
  "name": "无框能量图案",
  "constraints": { "text": false, "frame": false, "scene": false, "crop": false, "shadow": false },
  "defaults": {
    "preset": "centered",
    "view": "正面",
    "direction": "无方向",
    "occupancy": 0.7,
    "effectIntensity": "中",
    "background": { "type": "solid", "color": "#FFFFFF" }
  },
  "allowedOverrides": {
    "preset": ["centered"],
    "view": ["正面"],
    "direction": ["无方向"],
    "occupancy": { "min": 0.6, "max": 0.8 },
    "effectIntensity": ["中"]
  },
  "presets": { "centered": "主体居中，轨道穿插可读。" },
  "checks": ["无文字和边框", "主体及轨道完整"]
}
```

任务示例的 energy 类别需要在推荐核心中声明，对应例子见 core-guidance.md。JSON 片段必须合并到对应文件，不把 profile、设计或后端片段当作完整用户配置。
