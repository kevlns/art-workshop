# Vant 模式与调用流程

## 定位

模式与调用流程，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 操作流程

### 风格保存、打样与样张定版

创建风格，按 style、palette、rendering 分类导入分析参考。讨论澄清意图，按当前 revision 保存完整配置；规则可随时增删修改，有效 rules 保存后即可用于任务，无需派生或采用。style analyze 是可选辅助：--dry 只编译，实际 analyze 创建 taskId 与独立证据，逐图观察后生成建议报告。

报告含 summary、observations、recommendation、issues、notes、decisions 和 provenance。recommendation.rules 是精炼建议，不自动替换已保存的 config.rules。issues 给出实质矛盾的可执行选项，用户选择后可通过 style resolve 记录；review.ready 只表示分析建议可采用，不是直接保存规则的前置条件。

按明确要求使用 style update 保存规则，不为普通措辞修改重复分析；style revise 保留兼容入口并记录用户修订依据。每次保存维护当前核心与按哈希保留的历史快照，历史运行不覆写。derive 仅用于用户需要独立风格时，不是修改的必经步骤。

需要新增参考证据或分析复核时，复核复用未变化的图片观察并接收已有方案和决定。错误保留草稿和证据，本地完成后允许编辑；云端计算不确定性单独提示，见 [状态与恢复](troubleshooting.md)。

使用 style sample-job --id STYLE --revision N 创建仅规则打样任务，--count 可指定每个主体生成 1～4 张候选，配置模型后按普通计划与执行流程出图；创建任务不自动启动生成。用户认可候选时使用 style sample-select --id STYLE --revision N --job JOB --run RUN --candidate HASH 完成样张定版，加入当前风格的运行时参考；style sample-remove --sample SAMPLE 移除采用关系并保留历史文件。

样张绑定 rulesHash。任务 styleReferenceMode 默认 approved：从未采用样张时按文字规则生成并在预案标识 no-samples；已有样张全部过期时拒绝使用，混合新旧样张只使用当前规则匹配项；text-only 明确仅使用规则。原始分主题参考不会自动上传。模型不支持样张输入时明确报错，可显式切换 text-only。多图输入的风格用途说明不保证完全隔离主体与构图，需要真实出图验证。

style adopt 和 style recover 仅保留既有报告采用及中断事务的兼容路径，不是规则保存门槛。任务动态参考仍使用 job analyze。

候选图片使用“样张定版 / 取消样张定版”开关，对应兼容 API style sample-select / sample-remove；这只维护当前风格的运行时参考，不执行资产定版或导出。定版图片在“风格配置 → 运行时参考”显示，按图片内容哈希去重，重复图片不会新增一份。任务的 approved/text-only 决定是否使用运行时参考，不为每张参考另设启用开关。

### 远程文生图

选择已启用、目录可用、保存凭据且已适配的图片模型。先 generate show，再 generate plan 保存计划，run --plan --dry 核对请求，再按授权执行。生成 API 由协议适配器直接调用；CLI 示例仅为诊断，不是实际提交链路。

型号的生成/编辑模式、输入数量、尺寸、提示词与参数限制统一来自 [模型目录](remote-models.md)。不能把 URL+Key 或 image 标签视为已经适配；不能以注册型号推定账号权限。

生成提示词顺序为用途与主体、已保存风格规则、动态主体与关系、动态构图与背景、交付规格、必须可读特征及参考观察。风格的无条件抽象负向表达独立编译；有条件的排除完整保留在条件段。适配器根据模型能力保留独立负向参数或明确并入排除段。编辑提示分别列出修改与保留要求；同一范围可修改局部并保留其他特征，不按标签重叠直接判错。

透明输出通过 {type:"transparent"} 配置，计划绑定 PNG 处理契约；原图保留，候选使用校验后的透明 PNG。同色细节和半透明材质存在色键处理局限，不能承诺任意抠图质量。

### 本地内置文生图

ComfyUI 后端省略 workflow 时使用 Qwen Image 2.1 Q4 与 CPU 文本编码器。config validate 校验模板，doctor 检查服务、节点与模型；doctor --start 可启动并保留服务，不采样。plan/dry 不启动服务。内置工作流不证明模型文件、节点和显存已就绪。

### 本地自定义文生图

CLI 支持显式 API workflow 与 bindings，调用方负责节点、参数、输入图、数量、输出与生命周期适配。Vant 当前只开放已适配内置方案，不把任意工作流导入作为可运行选择。

### 远程图编辑

显式绑定 source 及哈希，声明 changes、preserve 和 mustRead。修改与保留不能冲突。默认保留原图风格；绑定目标 core 后由核心统一提供 style。必须使用支持 edit 的准确型号，不能套用文生图端点。

上传、提交、查询和下载使用冻结请求。上游身份保存在原运行，恢复仅查询原任务或取回原结果，不重新提交。

### 本地 Qwen 2.1 图编辑

使用适配后的 LoadImage.image、VAE 和图像编码器连接，底图上传后显式绑定。latent 输出尺寸与编码器 resolution 分开。服务可连接不等于真实编辑成功，验证需实际底图和输出。

### 生成与定版

前台和后台真实运行均登记 taskId。候选必须有可核验计划、运行身份和完整文件。check 仅做技术完整性检查，candidate finalize 记录用户选择；没有人工三维评分或「验收此图」阶段。

按资产定版，重复请求幂等；替换用 --replace 并保留历史。candidate delete 用 --confirm 明确影响，拒绝运行中或受引用文件。定版不会自动导入游戏或提交 Git。

空闲任务可更新配置后重新编译运行，原批次保留。派生任务独立建立身份，不继承报告、授权、执行或定版。[全部命令](commands.md) · [取消与恢复](troubleshooting.md)

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
