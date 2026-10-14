# 模式与调用流程

## 风格分析与核心冻结

创建风格草稿，按 style、palette、shape-language、rendering 分类导入私有参考。style analyze --dry 只编译；实际 analyze 创建 taskId 和独立证据。报告绑定配置版本、图片哈希、分析模型和规则指纹；更新配置或参考后必须重新分析。冲突与未知项未处理时不能采用。

style adopt 冻结当前已审阅报告；style recover 只恢复原已授权采用事务。正式风格只读，修改使用 derive，不能复制文件改身份。任务动态参考用 job analyze，只转写指定内容用途，不替代静态风格。

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
