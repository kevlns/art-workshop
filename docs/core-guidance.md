# 风格核心职责

风格只回答“如何绘制”，任务回答“画什么样”。分类和字段由 `lib/style-contract.mjs` 定义，校验与提示词由 `lib/core.mjs` 执行。

| 职能 | 风格字段 | 不承担的任务内容 |
| --- | --- | --- |
| 媒介 | medium | 主体身份和题材 |
| 描绘繁简 | render.detail | 轮廓、比例、结构、部件数量 |
| 明暗画法 | render.shading、toneSteps、valueContrast | 光源位置、方向和场景光照 |
| 描边 | render.outline | 主体形状 |
| 高光画法 | render.highlights | 金属、玻璃、皮肤等物理材质 |
| 绘画痕迹 | render.brushwork | 鳞片、花纹、表面结构 |
| 色彩关系 | color.saturation、contrast、shadowShift | 主体身份色、固定内容色板 |

绘制细节低不代表删减任务要求的结构，干净笔触不代表删掉物体纹理。任务中的身份色和实际光源保持有效。核心不再包含 shape、lighting、domains，也不以题材白名单限制实体 kind。

静态参考只分三类：style（媒介与整体绘制气质）、palette（色彩关系）、rendering（明暗、描边、笔触与刻画）。主体图片可以仅作配色参考，不根据文件名改分类。具体造型参考属于任务 subject，物理材质属于 surface，场景光源属于 scene-light；参考不自动移入或上传到其他用途。

风格报告和冻结核心使用 schemaVersion=2。新分析必须返回当前结构；旧报告不能采用，旧核心不能生成或执行旧计划。旧核心、报告、历史产物原样保留，可派生草稿后核对参考、重新分析并明确采用。已取消的分类保留为待重新分类资源，禁止猜测迁移。项目对象的 schemaVersion=2 不变，职责版本与对象存储版本分别校验。

输入参考与输出 observations.scope 共用范围：style、palette、rendering；content 和 asset 仅标记任务内容与资产观察，不进入风格推荐。无另一套隐式别名。
