---
name: art-workshop
description: 使用美术工坊进行风格分析与核心冻结、远程或本地 ComfyUI 生图和编辑、工作流及环境检查、任务取消与服务关闭。任务提到美术工坊、art 工具、核心冻结、统一风格图片或其工作流时使用。
---

# 美术工坊

随包规范是权威来源。已安装 v-cli 时调用 v-cli art；首次先运行 v-cli agent docs art 和 v-cli agent describe art --json。独立使用读取同目录 runtime.json，通过 node <entry> 调用；全局安装也可用 art-workshop。以下前缀使用 v-cli art。

## 发现与模式选择

先 config show、agent index、config validate，确认实际外部路径、后端、工程、任务、核心。完整规范用 agent docs 查看；generate/edit show 读取任务，不猜身份。

| 模式 | 执行前检查 |
|---|---|
| 远程生图 | 百炼真实入口及 bl auth status/config show；config validate；generate plan、run --dry |
| 远程编辑 | 远程检查加原图与 changes/preserve；edit plan、run --dry |
| 本地内置 | workflow list、config validate、doctor；generate plan、run --dry |
| 本地自定义 | API JSON/bindings、插件与模型、单张输出；config validate、doctor、plan、dry |
| 本地 Qwen 2.1 编辑 | 一张底图、image/vae 绑定与编码器、修改/保留不冲突；doctor、edit plan、dry |
| 分析与冻结 | 百炼 analysisModel、参考 scope；analyze --dry、报告 validate；用户采用后 freeze |

远程 doctor 只是配置检查，当前百炼 CLI 无 bl doctor。style analyze 仍使用远程百炼，不随本地生图后端切换。pure local run 不需要百炼凭证。

## 生图与编辑流程

```powershell
v-cli art config validate --backend local-qwen
v-cli art doctor --backend local-qwen
# 服务未运行时可按配置启动后检测，不采样。
v-cli art doctor --backend local-qwen --start
v-cli art generate show --project P --job J
v-cli art generate plan --project P --job J --backend local-qwen --out .cache/plan.json
v-cli art generate run --plan .cache/plan.json --item ITEM --dry
v-cli art generate run --plan .cache/plan.json --item ITEM --background
```

P/J/ITEM 为需替换的真实身份，local-qwen 须已声明。编辑用 edit show/plan/run，选择有编辑能力的后端。未传 --backend 时由 generation.defaultBackend 选择；都未声明则仍走百炼默认。comfyui 后端省略 workflow 时选择 vant-builtin-qwen-image-2.1-Q4-8GB 内置文生图模板，默认 CPU 文本编码、512×512；权重和插件需已安装。

新计划可以 --backend 选远程/本地 ID。冻结 --plan 不能同时传 backend/project/job/core/explore；只选 item/variant/offset/limit 等执行范围。修改需求、模板、参数或原图后重新 plan，不手改快照或哈希。

variants 是构图/seed 候选，perValue 是每个组合的张数，limit 按 item 数。run 默认 base；新来源调用 --explore 展开候选。--timeout 只用于 task wait。本地要求每边为 32 的倍数、扩写和水印关闭；不自动改变设计尺寸。UI design 基于 profile 分辨率和单体尺寸/倍率换算，每边实际输出 256～4096，检查每项 execution。

## 核心与原图

核心只定义可复用视觉语言；实体、数量、身份色、动作和关系属于需求；背景、构图许可、设计基准属于资产；模型和尺寸属于执行。

文生图核心依次选显式 --core、任务 core、工程 defaultCore。冲突需改任务，不跨工程回退。默认纯白背景，其他背景必须明确允许。编辑默认保留原图风格，不读 defaultCore；绑定 core 后不能重复声明 style 修改/保留。原图与分析参考图语义不同，不将参考图自动用作编辑底图。

style analyze 只生成报告，不自动冻结；style validate 检查结构与冲突，人工审阅后由用户采用，再 style freeze。已有核心不可覆写。用户既有执行授权持续有效，不重复询问；仅预演或生成报告不能自行扩大到付费执行或冻结。

## 任务、失败与验收

```powershell
v-cli art task status TASK
v-cli art task wait TASK --timeout 60
v-cli art task cancel TASK
v-cli art shutdown
v-cli art check RUN --out .cache/review.json
```

前台和后台都创建 task。wait 超时不会取消；cancel 仅停止指定任务，保留服务。shutdown 停止当前配置范围全部生图/编辑任务，清空关联 ComfyUI 队列、中断执行并核验身份后关闭服务，也影响同后端浏览器任务。同步分析不在队列内。远程 cancel 不保证云端停止或费用撤销。

失败读取 task status 的 diagnostic、error、manifest 与日志：环境/提交/执行阶段、workflow/backend、节点和原始错误、修复提示。failed/lost 不证明后端停止，unsettled 必须如实报告。不得擅自换模型、后端或设计尺寸；修复后重新 plan/dry。

check 只核对完整性并汇总 content/style/asset 人工验收；全部 pass 才可 select。环境检查、mock 测试、模型输出都不等于实际图像或生产资产通过。

## 路径与副作用

资源放在安装目录之外。相对 input/report/plan/out/review/source 基于 workspace，RUN 基于 output，参考图基于实际 refs，workflow/launch 路径基于配置目录。目录覆盖建议绝对路径。

plan/dry 不联网、启动服务、上传或采样；普通 CLI 仍可补 refs 分类，plan --out 写计划。config validate/doctor/workflow list 不补 refs；doctor --start 可启动并保留服务。检测通过不保证权重加载、显存或效果。

用 refs guide 查实际分类；输入显式指定参考 path/scope/note。随包 SKILL.md 是源，agent init 同步到已有技能目录并保留扩展，不写工作区 AGENTS.md；避免直接改同步副本。
