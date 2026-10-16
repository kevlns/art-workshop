# 模式与调用流程

## 风格分析与核心冻结

创建风格草稿，按 style、palette、rendering 分类导入私有参考。讨论澄清意图并回填草稿。style analyze --dry 只编译；实际 analyze 创建 taskId 与独立证据，逐图观察后生成风格报告。

报告含 summary、observations、recommendation、issues、notes、decisions 和 provenance。recommendation.rules 是可以独立使用的精炼规范，不含讨论过程。notes 不阻塞采用；issues 给出可执行选项。用户选择后通过 style resolve 记录决定，无需重新分析。style read 的 review.ready 为采用条件，不以聊天中的“可采用”作为事实。

草稿或参考改变时保留报告并标记需复核，复核复用未变化的图片观察并接收已有方案和决定。错误保留草稿和证据，本地完成后允许编辑；云端计算不确定性单独提示，见 [状态与恢复](troubleshooting.md)。

style adopt 冻结当前有效规则与决策证据，style recover 只恢复原已授权事务。正式风格只读，修改使用 derive。任务动态参考仍使用 job analyze，不替代静态风格。

## 远程文生图

选择已启用、目录可用、保存凭据且已适配的图片模型。先 generate show，再 generate plan 保存计划，run --plan --dry 核对请求，再按授权执行。生成 API 由协议适配器直接调用；CLI 示例仅为诊断，不是实际提交链路。

型号的生成/编辑模式、输入数量、尺寸、提示词与参数限制统一来自 [模型目录](remote-models.md)。不能把 URL+Key 或 image 标签视为已经适配；不能以注册型号推定账号权限。

## 本地内置文生图

ComfyUI 后端省略 workflow 时使用 Qwen Image 2.1 Q4 与 CPU 文本编码器。config validate 校验模板，doctor 检查服务、节点与模型；doctor --start 可启动并保留服务，不采样。plan/dry 不启动服务。内置工作流不证明模型文件、节点和显存已就绪。

## 本地自定义文生图

CLI 支持显式 API workflow 与 bindings，调用方负责节点、参数、输入图、数量、输出与生命周期适配。Vant 当前只开放已适配内置方案，不把任意工作流导入作为可运行选择。

## 远程图编辑

显式绑定 source 及哈希，声明 changes、preserve 和 mustRead。修改与保留不能冲突。默认保留原图风格；绑定目标 core 后不再重复声明修改或保留 style。必须使用支持 edit 的准确型号，不能套用文生图端点。

上传、提交、查询和下载使用冻结请求。上游身份保存在原运行，恢复仅查询原任务或取回原结果，不重新提交。

## 本地 Qwen 2.1 图编辑

使用适配后的 LoadImage.image、VAE 和图像编码器连接，底图上传后显式绑定。latent 输出尺寸与编码器 resolution 分开。服务可连接不等于真实编辑成功，验证需实际底图和输出。

## 生成与定版

前台和后台真实运行均登记 taskId。候选必须有可核验计划、运行身份和完整文件。check 仅做技术完整性检查，candidate finalize 记录用户选择；没有人工三维评分或「验收此图」阶段。

按资产定版，重复请求幂等；替换用 --replace 并保留历史。candidate delete 用 --confirm 明确影响，拒绝运行中或受引用文件。定版不会自动导入游戏或提交 Git。

空闲任务可更新配置后重新编译运行，原批次保留。派生任务独立建立身份，不继承报告、授权、执行或定版。[全部命令](commands.md) · [取消与恢复](troubleshooting.md)
