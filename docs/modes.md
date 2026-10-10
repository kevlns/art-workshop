# art 模式与调用规范

本规范适用于通过 v-cli art、art-workshop 或 Node 入口调用的同一工具。示例后端 remote-qwen、local-qwen、local-custom、local-edit 是配置 ID；P、J、ITEM、TASK、RUN 为需替换的身份或路径。

## 所有模式的共同检查

1. 首次通过 v-cli 调用先读取 v-cli agent docs art 与 v-cli agent describe art --json，确认当前安装版本支持的命令与参数。
2. config show 确认实际 config、workspace、output、refs；agent index 发现真实工程、任务及核心，不猜测 ID。
3. config validate 校验配置和模板。检查全部后端失败时定位相应项；可用 --backend 只检查本次选择，其他后端问题不会因此修复。
4. generate/edit show 读取任务。确认模块、核心选择、主体或原图、资产约束、尺寸、候选数与授权范围。
5. 按对应模式检查依赖，再 plan 固化参数。运行 --plan 的 --dry 查看所选项请求，确认模型、size、seed、候选、输入图片和输出路径。
6. 在已授权的任务范围内执行。首次验证选择一个 item/variant；--limit 按 item 数限制，不按实际图片数限制。
7. 根据 taskId 跟踪结果，读取 manifest 与失败信息；生成成功后仍逐图人工验收。

预演不会获得后续付费调用授权。已有明确生图或编辑授权时继续执行，不重复确认。冻结核心需要用户采用该报告的依据；不要把仅生成或查看报告当作采用。

## 远程文生图

远程使用 provider=bailian。art 将请求交给 bailian-cli，认证、区域和 Base URL 由该 CLI 配置管理；art 配置不保存 API Key，也没有 --api-key/--base-url 透传入口。BL_BIN 可指定 bailian-cli/dist/bailian.mjs 的真实 Node 文件，不是 .cmd/.ps1 shim。

调用前检查：

- bl --help 与 bl image generate --help 确认入口及当前版本参数。
- bl auth status 确认模型 API 凭证；bl config show 确认生效配置与区域。不要在共享日志中输出完整密钥。
- art doctor --backend remote-qwen 仅检查 art 配置，不能证明认证、联网、额度或模型可用。当前百炼 CLI 没有 bl doctor 入口。
- 模型尺寸、数量等限制以服务端和当前模型为准；art 的 256～4096 通用像素检查不能替代模型能力检查。

```powershell
bl image generate --help
bl auth status
bl config show
v-cli art config validate --backend remote-qwen
v-cli art generate show --project P --job J
v-cli art generate plan --project P --job J --backend remote-qwen --out .cache/remote-plan.json
v-cli art generate run --plan .cache/remote-plan.json --item ITEM --variant base --dry
v-cli art generate run --plan .cache/remote-plan.json --item ITEM --variant base --background
```

实际执行会发送提示词并可能产生费用。固定 seed 便于对照，但模型更新、采样实现和环境变化可能影响结果，不能承诺跨后端逐像素一致。

## 本地内置文生图

选择 provider=comfyui 且省略 workflow，或填 vant-builtin-qwen-image-2.1-Q4-8GB。内置 bindings 可省略；所需模型名和 API/UI 文件位置由 workflow list 返回。

调用前检查：

- config validate 确认 endpoints 是显式本机 HTTP 根地址，launch 指向可用入口，模型与尺寸配置正确。
- doctor 检查 ComfyUI >=0.39.0、节点注册、模型枚举、连接输出索引和启动路径。未运行服务时可用 --start；检测后服务保留，不采样。
- workflow list 中的模型和插件必须已经安装；art 不安装依赖或下载权重。
- 内置 8GB 模板将文本编码器放在 CPU，512×512 为默认值；实际更大尺寸的显存、RAM和速度需任务验证。promptExtend、watermark 必须关闭；本地每边须为 32 的倍数。

```powershell
v-cli art config validate --backend local-qwen
v-cli art workflow list
v-cli art doctor --backend local-qwen --start
v-cli art generate plan --project P --job J --backend local-qwen --out .cache/local-plan.json
v-cli art generate run --plan .cache/local-plan.json --item ITEM --dry
v-cli art generate run --plan .cache/local-plan.json --item ITEM --background
```

正常 run 自行复用服务或懒启动；doctor --start 用于提前验证，不是每次运行的必需步骤。未配置 launch 时，只能复用已经可用的服务。GPU 权重在首次采样时加载，HTTP 检测通过不代表权重能成功加载。

## 本地自定义文生图

自定义模板仍走 ComfyUI 适配器，不是任意推理引擎。workflow 指向 API JSON，必须声明 prompt/width/height/seed bindings。根据模板声明 negativePrompt/count/model，约束详见配置文档。

调用前额外检查：

- 用 ComfyUI 的 API 格式导出，而非画布 nodes/links 格式。config validate 确认节点、连接及绑定存在。
- 输出须每次恰好一张最终图片，默认串行执行 perValue 个采样；不要同时让 batch_size>1 或多个 SaveImage 节点产生多个最终输出。
- doctor 读取环境中真实节点和选项。自定义节点的完整执行校验、必需输入类型或任意复杂逻辑仍由 ComfyUI 提交及执行决定。
- steps/cfg/sampler/scheduler 配置写入 seed binding 所在节点；该节点须具有相应输入，否则 plan 拒绝。

```powershell
v-cli art config validate --backend local-custom
v-cli art doctor --backend local-custom --start
v-cli art generate plan --project P --job J --backend local-custom --out .cache/custom-plan.json
v-cli art generate run --plan .cache/custom-plan.json --item ITEM --dry
v-cli art generate run --plan .cache/custom-plan.json --item ITEM --background
```

修改模板、bindings、参数或核心后重新 plan。冻结计划保留工作流快照，不会自动读取磁盘上后来修改的模板。

## 远程图编辑

使用远程后端，额外检查 bl image edit --help，以及原图存在、可读并符合模型输入要求。source 是待编辑的底图；风格分析参考图不会自动加入编辑请求。

```powershell
bl image edit --help
bl auth status
v-cli art config validate --backend remote-qwen
v-cli art edit show --project P --job J
v-cli art edit plan --project P --job J --backend remote-qwen --out .cache/remote-edit-plan.json
v-cli art edit run --plan .cache/remote-edit-plan.json --item ITEM --dry
v-cli art edit run --plan .cache/remote-edit-plan.json --item ITEM --background
```

必须明确 changes、preserve、mustRead，同一范围不能同时修改和保留。编辑默认保留原风格，不使用工程 defaultCore；若明确绑定 core，则不能再声明 style 修改或保留。原图哈希变化需重新 plan。

## 本地 Qwen 2.1 图编辑

当前本地图编辑适配的是 Qwen 2.1 参考图编码路径，每项仅一张底图；不是支持所有 ComfyUI 编辑图的通用适配器。内置文生图模板没有 image/vae 编辑绑定，不能直接作为默认编辑后端使用。

创建 local-edit 自定义 API 模板及后端：image 绑定 LoadImage.image，vae 绑定 VAELoader.vae_name，prompt 绑定 TextEncodeQwenImage21.prompt。执行时上传原图，将编码器 images.image_1 和 vae 连接到相应节点。LoadImage 中原图占位文件无需预先存在，因为真正文件在任务执行时上传。

```powershell
v-cli art config validate --backend local-edit
v-cli art doctor --backend local-edit --start
v-cli art edit show --project P --job J
v-cli art edit plan --project P --job J --backend local-edit --out .cache/local-edit-plan.json
v-cli art edit run --plan .cache/local-edit-plan.json --item ITEM --dry
v-cli art edit run --plan .cache/local-edit-plan.json --item ITEM --background
```

dry 展示模板和动态参数但不上传原图，因此不显示服务器最终分配的上传文件名。输出 size 由 latent 尺寸控制；编码器 resolution 控制参考编码，不替代输出画布，也不保证原图比例自动保持。

## 风格分析与核心冻结

style analyze 使用百炼 analysisModel；选择本地 generation 后端不会使分析转为本地。先检查 bl auth status 及 bl vision describe --help / bl text chat --help。纯语言输入调用文本分析，一张参考图调用视觉分析，多张图分别观察后合并；存在有效缓存时可复用报告。

```powershell
bl auth status
bl vision describe --help
bl text chat --help
v-cli art style analyze --project P --input projects/P/briefs/style.json --dry
v-cli art style analyze --project P --input projects/P/briefs/style.json --out projects/P/reports/style.json
v-cli art style validate --project P --report projects/P/reports/style.json
# 用户已采用该报告，且无未解决冲突或不确定项时执行。
v-cli art style freeze --project P --report projects/P/reports/style.json
```

参考 path、scope、note 必须显式声明。报告中的主体、颜色、数量、布局和背景不能误冻为普遍风格。同步分析不返回 taskId，不受 task cancel 或 shutdown 管理。

## 计划、数量与结果检查

variants 是同一需求的构图/seed 候选；perValue 是每个选中 item/variant 的出图张数（1～4）。预计图片数等于选中组合数乘对应 perValue。--limit/--offset 按独立 item ID 计数。run 默认 base；新计划来源调用可用 --explore 展开候选；冻结计划运行只能按 --variant 选择，不能加 --explore。

运行冻结计划时可以设置 --item、--variant、--offset、--limit、--dry、--background 及输出路径，但禁止同时覆盖 --backend、--project、--job、--core、--explore。--timeout 只用于 task wait，不设置模型任务超时；ComfyUI 采样超时在 backend.options.timeoutSeconds。

每种模式都须核对 planHash、后端、每项 execution、refs 和候选选择。失败读取 diagnostic 与日志；成功进入 check 的 content/style/asset 人工验收，不能只看 CLI 退出码。
