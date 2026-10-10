# art Agent 调用规范

本文件是 @kevlns/art-workshop 的随包执行规范。用户已经给出的授权与偏好持续有效；已有生图、编辑或服务管理授权时继续完成任务，不重复询问。仅预演、查看或分析报告不自动授权付费执行或采用风格。

## 首次发现与路径确认

```powershell
v-cli agent index --json
v-cli agent docs art
v-cli agent describe art --json
v-cli art config show
v-cli art agent index
v-cli art config validate
```

首次 official 调用前读取插件规范，实时参数由 describe 确认。工程和任务以 index、generate/edit show 为准，不猜 ID。配置字段和资源路径以 config show 为准，不在工具安装目录写工程、原图、计划或产物。随包 [模式规范](docs/modes.md)、[配置规范](docs/configuration.md)、[命令参考](docs/commands.md) 是完整操作指导；agent docs 输出全部指南。

## 按模式检查后再执行

| 模式 | 必须核对 |
|---|---|
| 远程文生图 | provider=bailian；百炼真实入口、auth status、config show；模型和执行参数；plan 与 run --dry |
| 远程编辑 | 远程检查加原图哈希、changes/preserve/mustRead；编辑模型能力；edit plan 与 dry |
| 本地内置文生图 | 内置名称/模型、config validate、doctor；32 像素对齐、关闭扩写/水印；plan 与 dry |
| 本地自定义文生图 | API JSON、bindings、插件/模型/输出数量；config validate、doctor、plan 与 dry |
| 本地 Qwen 2.1 编辑 | 编辑模板、LoadImage.image 和 VAELoader.vae_name 绑定、编码器；一项一张原图；范围检查、doctor、edit plan 与 dry |
| 风格分析/冻结 | 百炼 analysisModel 与参考 scope；analyze --dry；报告 validate、人工审阅、用户采用后 freeze |

模式检查是 Agent 调用要求；不要宣称 CLI 已自动完成百炼凭证验证或人工图片审查。doctor 的远程结果只是配置检查。当前百炼 CLI 无 bl doctor，使用 bl auth status、bl config show 和实际模型入口帮助；认证信息不得泄露。

正常 run 可懒启动本地服务；提前验证时可以 doctor --start，不执行采样，检查后服务保留。plan/dry 不启动、探测 ComfyUI 或加载权重。配置/环境检查通过不代表实际采样、显存或图像质量通过。

## 编译与来源约束

- 新任务明确 --project、--job；用 --backend 选配置 ID。未声明默认后端也未显式选时走百炼通用路径；comfyui 后端省略 workflow 时才选择内置 vant-builtin-qwen-image-2.1-Q4-8GB。
- 先 show 读来源，再 plan 保存快照与哈希，run --plan --dry 校对所选项。已有明确执行授权时按已确认范围运行。
- 冻结计划运行禁止 --backend、--project、--job、--core、--explore；可选 item/variant/offset/limit/dry/background。修改来源、配置、模板或原图后重新 plan，不手改哈希。
- --limit 按 item 数，variants 是构图候选，perValue 是每组合出图数。不要把 limit 1 当作保证只生成一张。
- --timeout 只用于 task wait；本地采样 timeout 在 options.timeoutSeconds。后端没有 promptExtend/watermark 能力时不能静默忽略。

## 内容与核心职责

核心负责可复用视觉规律；实体身份、数量、色相、动作及关系属于任务；背景、留白、文字、场景和设计基准属于 profile；模型及尺寸属于 execution/backend。按 [核心冻结指导规则](docs/core-guidance.md) 检查职责、证据与冲突。

文生图核心依次为显式 --core、任务 core、工程 defaultCore。冲突或缺少选择时报错，不跨工程回退。编辑默认保留原图风格；明确绑定 core 后不能再声明 style 修改/保留。source 必须是真正编辑底图，不将风格参考图误传为主体。

设计换算以每项 execution 为准：每边 256～4096，本地还须为 32 的倍数；不自动改倍率、拉伸、补边。编码器 resolution 与输出 latent 尺寸是不同参数。普通生图默认纯白背景，其他背景须由需求和资产约束明确允许。

## 任务和进程

run --background 返回 taskId；前台同样创建 task。用 task status/wait 检查结果。wait 超时不取消任务；task cancel 只取消指定运行、保留服务；failed/lost 不证明后端已停止。

shutdown 阻止提交、停止当前配置范围全部 art 生图/编辑任务、清空配置和历史快照关联后端队列、中断采样、等待停止、核验进程身份后关闭服务。浏览器提交到同一后端的任务也受影响。同步 style analyze 不在任务队列内。

无法确认停止时保留 unsettled 并如实报告；不能广泛终止所有 Python 进程。远程 cancel 只保证本地 bl 退出，不保证云端取消、计费撤销；读取 remoteCancellation 与 remoteCancellationUnconfirmed。

## 失败与结果报告

本地任务失败先读取 error、diagnostic、manifestPath、logPath。diagnostic 提供阶段、workflow/backend、节点与原始错误，环境失败可能包含 environments。按节点缺失、模型枚举、连接、启动或内存原因处理，不自动换模型、后端或设计尺寸。修复后重新 plan/dry 再在授权范围重试。

生成成功后 check 导出 content/style/asset 人工验收；只有完整性有效、生成成功且全部 pass 的唯一图片可 select。不要把模型输出、mock 测试或环境检测当作生产验收。报告说明实际模式、模型、任务结果、输出位置和已做验证，明确未验证的云端、显存或视觉边界。

## 文档与技能维护

随包 skills/art-workshop 是技能源，修改后用 agent init 或 skill:sync 同步；不直接改已同步副本。init 只刷新已有 Agent 技能目录里的随包文件，保留扩展，不写工作区 AGENTS.md。正常非 dry 分析/冻结/run 可自动同步，查询、plan、dry 不自动同步。

修改调用规范时同步更新 README、docs、SKILL.md 和 v-cli.plugin.json；执行 npm run docs:check、适当测试、pack:guard 和安装检查。历史试验报告仅为观察记录，不是旧命令、现价或通用模型规律的依据。
