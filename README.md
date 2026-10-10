# 美术工坊 art

美术工坊将风格分析与核心冻结、文生图、图编辑分为三个模块。生图和编辑可选百炼远程后端或本机 ComfyUI；全部生图后端配置保存在一份用户 config.json。风格分析仍调用百炼，与 generation.defaultBackend 独立。

本指南对应 0.2.1 的命令协议。命令与参数以实际安装的 v-cli agent describe art --json 为准。

## 阅读入口

| 文档 | 内容 |
|---|---|
| [模式与调用规范](docs/modes.md) | 每种模式的检查顺序、预演与执行流程 |
| [统一配置](docs/configuration.md) | 配置字段、优先级、路径及工作流绑定 |
| [工程与输入结构](docs/data-formats.md) | 工程、分析输入、生成任务、编辑任务、设计尺寸 |
| [命令参考](docs/commands.md) | 全部入口、参数、退出结果及副作用 |
| [诊断与任务控制](docs/troubleshooting.md) | 环境与工作流错误、取消及 shutdown |
| [核心冻结指导规则](docs/core-guidance.md) | 风格职责、报告检查、冻结与验收 |
| [Agent 规范](AGENTS.md) | AI Agent 的执行要求 |

## 安装与发现

要求 Node.js >=20。通过 v-cli 调用时，art 是官方插件；独立安装可用 npm install -g @kevlns/art-workshop。远程生图、编辑及风格分析另需已配置的 bailian-cli；纯本地生图不依赖百炼凭证。ComfyUI、插件和模型权重需独立安装，art 不自动下载。

```powershell
v-cli agent index --json
v-cli agent docs art
v-cli agent describe art --json
v-cli art --version
v-cli art config show
v-cli art agent index
```

本文示例统一使用 v-cli art。独立安装将前缀替换为 art-workshop；源码运行替换为 node art-workshop.mjs。独立 skill 的 runtime.json 记录实际 Node 入口，避免猜测安装路径。

## 执行前选择模式

| 模式 | 后端选择 | 执行前检查 |
|---|---|---|
| 远程文生图或编辑 | --backend remote-qwen | config validate、百炼入口与认证、任务 plan、run --dry |
| 本地内置文生图 | --backend local-qwen | config validate、workflow list、doctor、plan、run --dry |
| 本地自定义文生图 | --backend local-custom | 自定义 API JSON/bindings 校验、doctor、plan、run --dry |
| 本地 Qwen 2.1 图编辑 | --backend local-edit | 编辑模板/image/vae 绑定、doctor、原图和范围检查、plan、run --dry |
| 风格分析与冻结 | analysisModel 或工程 analysisModel | 百炼入口与认证、analyze --dry、报告 validate、用户采用后 freeze |

这些检查是调用规范；CLI 不会自动执行百炼认证检查或人工图像审查。实际本地任务会重新探测环境，启动与工作流错误会写入任务状态和 manifest。config validate 检查全局配置及模板，不校验所有工程任务；plan 才检查指定任务和实际单体参数。doctor 通过不等于采样或显存验证通过。

## 一次本地文生图

以下 P、J、ITEM 是占位符，必须替换为 agent index 和 generate show 返回的真实身份。PLAN 是相对于 workspace 的计划路径。后端 ID 必须已在用户配置中声明。

```powershell
v-cli art config validate --backend local-qwen
v-cli art workflow list
v-cli art doctor --backend local-qwen
# 服务未运行时，按配置启动并检测；不执行采样。
v-cli art doctor --backend local-qwen --start
v-cli art generate show --project P --job J
v-cli art generate plan --project P --job J --backend local-qwen --out .cache/local-plan.json
v-cli art generate run --plan .cache/local-plan.json --item ITEM --dry
v-cli art generate run --plan .cache/local-plan.json --item ITEM --background
```

默认内置模板名为 vant-builtin-qwen-image-2.1-Q4-8GB。本地后端省略 workflow 时使用该模板，默认后端 ID 仍由 generation.defaultBackend 决定。模板为 Qwen 2.1 文生图，CPU 文本编码、512×512 默认画布；不声明 generation.defaultBackend 且未传 --backend 时仍走远程默认模式。内置模板不是开箱即用的模型安装包。

远程与编辑流程见 [模式规范](docs/modes.md)。新计划可以选择 --backend；运行冻结计划时不能再传 --backend、--project、--job、--core 或 --explore。修改配置或需求后重新 plan，不手改计划。

## 任务与验收

```powershell
v-cli art task list
v-cli art task status TASK
v-cli art task wait TASK --timeout 60
v-cli art task cancel TASK
v-cli art shutdown
```

TASK 替换为 run 返回的 taskId。前台运行也创建任务并等待；后台立即返回 ID。wait 超时不会取消任务。cancel 只停止指定任务，保留本地服务；远程取消只保证本地调用退出，云端请求是否撤销不能保证。

shutdown 停止当前配置范围内全部 art 生图/编辑任务，清空关联 ComfyUI 队列、中断采样，等待停止，再关闭经身份核验的服务进程。它也影响相同后端上浏览器提交的任务。同步风格分析不属于这个任务队列。失败时读取 diagnostic、日志及 unsettled，不能把失败或 lost 当作后端已停止。

```powershell
v-cli art check RUN --out .cache/review.json
# 按实际图片填写 content/style/asset 的 pass、fail 或 pending，以及 reason。
v-cli art check RUN --review .cache/review.json
v-cli art select RUN --item ITEM --variant base --review .cache/review.json
```

RUN 替换为输出目录名或 manifest 路径。check 检查记录与哈希并汇总人工判断，不自动评价图片。只有完整性有效、生成成功且三个维度全通过的唯一产物可 select。

## 文件与默认值

config path/show/init 管理用户配置；默认输出为系统下载目录/image.g。工程、原图、参考、报告、计划、缓存和运行产物必须放在工具目录之外。一般相对资源路径基于 workspace；check/select 的相对 RUN 基于 output；参考图 path 基于实际 refs；自定义 workflow 和 launch 路径基于 config.json 所在目录。

plan 和 --dry 不调用生图或启动服务，但普通 CLI 路由会补齐 refs 分类目录；plan 指定 --out 会写计划。config validate、doctor、workflow list 走独立检查路由，不补齐 refs。doctor --start 可启动并保留服务，权重通常在首次实际采样时加载。

远程通用默认是 qwen-image-3.0-pro、1024×1024，每候选一张，扩写和水印关闭。内置本地模板另提供 512×512 默认值。最终模型和每项尺寸以 plan 与 dry 为准；配置优先级见 [统一配置](docs/configuration.md)。

## 随包文档与开发检查

agent docs 输出完整指南；agent init 只向指定目录下已有 Agent 技能目录同步随包 skill，保留扩展文件，不写 AGENTS.md。正常分析、冻结及非 dry 运行可自动同步；只读命令、plan、dry 不自动同步。用户配置 autoSyncSkills=false 可关闭自动同步。

```powershell
v-cli art agent docs
v-cli art agent init --directory C:/MyProject --dry
v-cli art agent init --directory C:/MyProject
npm run docs:check
npm run check
npm run test:package
```

开发检查验证文档命令、配置示例、单元及集成测试、包内容与安装入口；模拟后端测试不代表真实云端或模型效果验证。[2026-10-08 试验记录](docs/问题报告-2026-10-08.md) 只保留历史观察，不作为当前接口、价格或模型行为规范。
