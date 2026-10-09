# 美术工坊 Agent 指导

首次使用运行 v-cli agent docs art、v-cli agent describe art --json，再用 v-cli art config show 和 v-cli art agent index 确认外部路径、工程及核心。所有独立 art-workshop 命令都可通过 v-cli art 原样调用。详细流程、配置和输入结构用 v-cli art agent docs 查看，参考分类用 v-cli art refs guide 查看。

## 流程与规则

- 风格分析与冻结：style analyze 生成报告，style validate 校验，用户采用报告后 style freeze。核心语言精炼、用词准确、前后一致、模块职责清楚；可复用视觉语言归核心，主体与动作归任务，背景与构图归资产配置，模型与尺寸归执行。已有冻结核心不可覆写。
- 文生图：generate show 读取任务，generate plan 编译计划，generate run --plan FILE --dry 预演，授权后去掉 --dry 生图。工程内核心选择为显式 --core、任务绑定、工程默认；冲突拒绝，不跨工程回退。默认纯白背景，其他背景必须明确声明。
- 图编辑：edit show / plan / run，明确原图、修改范围及保留范围。预演后按任务授权执行；不自动换背景或套默认核心。原图变化后重新预演。
- 计划与 dry 不调用远程模型，不产生图片；真实分析与生成会调用 bl 并产生费用。修改需求后重新编译，不手改冻结计划。
- check 导出或汇总人工验收，分别检查 content/style/asset；三项全部通过且完整性有效才可 select。工具不自动评价图片。

## 本地资源与配套

本地配置位于用户配置目录，可用 config path/show/init 发现；冻结核心在 workspace/projects/工程/cores。工程、参考、报告、计划、缓存、原图和产物都在安装目录之外，不纳入工具 Git 或 npm 包。相对资源按 workspace 解析，参考图按 refs 解析，RUN 按 output 解析。每次配置生效会补齐 refs 分类目录，包括 dry，不覆盖素材。

随包 skills/art-workshop 是使用规范源，agent init --directory DIR 同步到已有 Agent 技能目录，保留扩展文件；自动同步也可用 npm run skill:sync。v-cli 负责路由、清单与本指导发现，美术工坊负责实际任务、核心选择与模型请求。安装 v-cli 会安装此官方依赖。

UI 尺寸：文生图 profile.design 声明 resolution 与 outputScale，item.design 声明控件 width/height 与可选 outputScale。单体实际出图尺寸为设计尺寸乘倍率；不能同时指定任务 execution.size。换算越界报错，不自动改变比例；完整约束见 agent docs。
