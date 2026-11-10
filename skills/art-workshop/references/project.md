# Vant 美术工坊 Agent 规范

## 定位

管理项目风格、参考图、图片生成、编辑和定版。支持本地 ComfyUI 与远程图片模型。

## 调用流程

```sh
art-workshop config show
art-workshop config validate
art-workshop agent index
```

首次调用前读取本规范，使用命令帮助或插件清单核对参数和执行范围。

## 调用规范

用户既有授权与偏好持续有效；查询和预演不授权生成或采用。规范与实时参数通过 v-cli agent docs art 和 v-cli agent describe art --json 获取。

### 对象与参考

任务参考只提取 purposes 指定且未被 ignore 排除的特征。用途范围外、用户已明确覆盖的背景和绘制差异不构成阻塞；conflicts 仅列范围内不可调和要求，uncertainties 仅列影响执行的关键缺失，两者为非空字符串数组，无问题用 []。不得删除用户参考或清空报告来绕过分析；应明确参考范围后重新分析，真正的未决取舍再交用户决定。

工程对象使用 schemaVersion 2；读写前核实工程配置和当前 revision。
风格和任务都有稳定 id 与 revision。UI、聊天和 CLI 共用对象；写入、派生与清理提交预期 revision，冲突重新读取。风格规则可随时增删修改并保存，包括已有正式风格；有效 rules 保存即同步可执行核心，不需要派生、分析或采用。历史核心快照和运行证据保留，修改后重新编译预案。派生仅用于独立方向，不继承批次、授权与对话。
风格静态参考只有 style、palette、rendering，只分析媒介、描绘、明暗、描边、笔触和色彩关系。具体造型、比例、结构、部件、身份色、材质与光源属于任务。任务动态参考只有 subject、composition、pose、identity-color、surface、scene-light、text；编辑底图另列。导入复制原图，不修改用户文件。未适配直接参考时拒绝，不隐式上传风格图片。

### 风格生命周期

草稿可含 rules，每条为 id/scope/strength/instruction/when，avoid 可另填 negative 字符串数组。按媒介、描边、明暗、高光、笔触、刻画、配色整理，主题不必填满。required 必须遵守、default 默认倾向、avoid 必须避免；“默认少用”使用 default，不升级为禁止。条件保留在 when。风格负向只表达跨主体复用的抽象绘制语言，不排除具体主体、部件、身份色、物体纹理、材质或资产规格。negative 直接描述被排除的视觉特征，不加否定前缀；instruction 为同一规则的阅读说明，条件和例外写入 when。无条件且明确填写的 negative 编译为独立负向表达，条件规则连同排除表达保留在正向条件段；未填写 negative 的文字约束保留原文，不机械转换。支持负向参数的模型直接传递，不支持时由适配器并入排除段，不丢弃、不截断。
规则编辑使用 style update --project ID --id STYLE --revision N --input FILE，输入完整 {name,config} 并保留未修改字段。有效 config.rules 直接生效，不因报告过期或未决分析项强制重新分析。style revise 保留为兼容修订入口，记录用户修订方案与依据；原报告和参考证据不变，不伪造新的分析。

style create/read/update/derive/discard 管理风格；已有可执行风格也可 update。style analyze 是可选辅助，--dry 只读编译，不联网、启动服务或创建参考目录。实际 analyze 创建 taskId 与独立参考证据；task status/wait/cancel 控制执行，recover 查原登记，resume 仅按已记录的上游身份恢复查询与取回，不重新提交。
报告绑定源配置、参考与模型。更新配置保留报告并标记需复核，源证据保持不变。报告 recommendation.rules 是分析建议，config.rules 才是已保存规则；用户要求回填时必须取得实际保存回执。issues 仅列需用户取舍的矛盾；style resolve 按实际选择修订建议，不清空问题绕过分析。review.ready 只表示建议可采用，不限制直接保存规则。style adopt/style recover 保留兼容报告采用及其原中断事务，不是编辑保存的前置步骤。
退出风格配置先按宿主提供的保存或草稿机制处理未保存内容。分析与生成仍遵循原执行身份和停止确认；不能因切换页面或保存规则重投任务。

### 打样与样张定版

保存规则后使用 style sample-job --project P --id STYLE --revision N 创建普通生成任务，可选 --count 1～4 指定每个默认主体的候选数量（共三个主体，写入 config.execution.perValue），任务固定 styleReferenceMode=text-only，source 记录规则和核心哈希。创建任务不启动生成；配置模型并按普通任务预案运行，用户不满意时直接修改规则重新打样，不从不合格结果中强行选图。

用户认可成功候选后使用 style sample-select --project P --id STYLE --revision N --job JOB --run RUN --candidate HASH，可选 --note 记录用途；图片独立复制到风格 samples 目录，保留规则哈希、来源与模型。style sample-remove --project P --id STYLE --revision N --sample SAMPLE 移除当前采用关系，历史文件保留。样张定版不调用 candidate finalize，不导出到 VantArtForge。

后续任务 config.styleReferenceMode 为 approved（默认）或 text-only。approved 只使用匹配当前规则哈希的运行时参考，从未采用样张时按规则生成且预案明确 no-samples；已有样张全部过期则拒绝使用，混合新旧样张只采用当前匹配项并列出 staleCount。text-only 明确仅使用规则。后端不支持图片参考时明确报错，不能静默丢图。原始分主题图仅分析其指定用途，不自动全部上传；普通图片参考的用途提示不保证完全隔离主体或构图，需真实结果验证。

候选图片使用“样张定版 / 取消样张定版”开关，对应兼容 API style sample-select / sample-remove；这只维护当前风格的运行时参考，不执行资产定版或导出。定版图片在“风格配置 → 运行时参考”显示，按图片内容哈希去重，重复图片不会新增一份。任务的 approved/text-only 决定是否使用运行时参考，不为每张参考另设启用开关。

### 计划与执行

动态需求自由文本不设字数上限：意图、外观、颜色、动作、效果与关系、场景说明、编辑指令和可读特征均完整保存与编译，不为通过校验删减或截断。必填项仍检查非空、类型和占位符；标识符、模型名称、采样器等结构字段保留各自契约。

风格与任务用 config.analysis{provider,model} 保存独立视觉分析实例；任务另用 config.generation{backend,remote?,options?} 保存生成后端，remote 为 {provider,model}。本地采样参数通过任务 generation.options 保存：steps 为 1～10000 整数，cfg 为 0～100 数值，sampler/scheduler 为 ComfyUI 支持的名称。新任务的本地推荐值为 steps=25、cfg=3、sampler=euler、scheduler=simple；内置工作流采用同一默认值，确保普通 CFG 负向分支参与引导。显式配置（含 cfg=0/1）保留，采样参数随批次保存。省略沿用后端或工作流默认值，远程后端不接受这些参数。使用 job update（v-cli art.job-update）更新任务后重新 plan，核对 backend.options 和 dry 请求的采样节点；不要通过独立 CLI config.json 或宿主管理的工程 settings.json 调整当前任务。聊天模型不改写执行选择。CLI plan 优先使用显式 --backend，其次任务 backend，再按独立工具的本地配置选择；任务绑定后端时使用该后端的模型。宿主按实例注入凭据，不在对象或预案写入密钥；修改选择使原方案失效。

先读取实际 job，再 generate/edit plan 和 run --plan --dry，展示有效核心、设计尺寸、预留缩放、请求与实际像素、模型后端、候选数量和编辑底图。后端尺寸由工具统一解析，超限或未对齐选最近合法尺寸，保留设计基准并明确实际值；不承诺显存或自动缩放导出。
授权覆盖方案后使用 run --background；前台同样创建执行身份。配置、核心、规格、参考、底图和后端变化拒绝失效方案，重新编译。重启查 taskId，不重复提交。不自动换模型或重跑成功项。
每个任务只能有一个未停止确认的执行；编辑、派生、归档、恢复与运行共用状态检查。切页面不取消。
job discard 归档已停止的任务，草稿、待定版和已定版均可归档。按 revision 将任务标记为 discarded（归档存储状态），保留配置、参考、私有底图、运行、输出、收藏和定版历史；活跃列表、收藏及作品暂不显示。job restore 按同一身份和当前 revision 恢复到活跃列表，收藏与作品重新显示，不重新生成。归档与恢复均检查停止确认和版本，重复操作幂等；恢复后重新编译预案。风格 discard 将当前风格归档，保留已有核心和样张快照供历史运行核对，不删除历史依赖。

### 取消、异常和关闭

本地 ComfyUI 按资产及采样序号持久化 prompt ID。工作进程丢失后使用 task resume 或 Vant 原批次恢复入口，沿用原身份查询与取回，不重新上传或提交生图；未提交项不补发。Windows 心跳写入暂时失败记录诊断并重试，不能导致定时器异常退出；关键状态写入仍严格校验。

任务状态与停止证据分开。queued/running/cancelling 仍占用资源；unknown 或 stopConfirmed=false 保留资源。failed/cancelled 也不能单凭状态释放资源；dispatching/accepted 远程回执尚未结清时继续占用。工作进程丢失标记 unknown，不推测停止。
task cancel 只取消指定运行，保留服务。生成任务远程取消只停止本地客户端，上游停止未知如实报告，不允许清理。只读分析有 finishedAt、已知终态且工作进程已退出，无生成计划与回执时释放本地占用；云端计算与计费停止未知独立保留，不自动重发。没有完成证据的进程丢失仍保持 unknown。shutdown 阻止提交、停止关联任务、核验共享队列和进程身份后关闭本地服务，不清空共享队列；有其他任务或停止未确认时保留服务。不得广泛杀所有 Python。

### 生成与定版

透明背景使用 `{type:"transparent"}`：生成任务设置 composition.background，编辑任务设置 changes 中 background 的 value。预案记录 PNG 输出处理版本并参与哈希；含完全透明区域的原生 alpha 保留，接近不透明的 alpha 噪声不视为透明背景。否则从边缘核实约定洋红底色，容许模型色偏，仅处理与外边界连通的底色及混合边缘。原图保留，候选使用处理后的 PNG；缺少合格背景或可见主体则报错，不伪称透明成功。纯色去背景可能影响与外部底色连通的同色细节，不能承诺任意半透明材质的抠图质量。

编辑 target 是范围名称，允许 outline 等具体范围；同一范围可修改局部并保留其他特征，不能仅按标签重叠判矛盾。配置和预案仍校验字段、引用、版本及核心风格归属。

只有生成与定版两个产品阶段。check 验证计划、执行身份、文件哈希和完成事实；不要求人工 content/style/asset 评分。candidate finalize 按资产选定候选，并把图片复制到美术仓库 VantArtForge。导出名称可空，空名称使用 vant-gen-任务-资产-批次。同一候选且同一导出名重复操作幂等；替换已有定版需要明确 replace，保留历史。导出文件名不能包含路径。
候选 editable 与 accepted 分开：已停止批次中保留的有效图片可作为编辑底图，输出处理失败不阻止继续编辑；已记录的哈希不匹配、文件缺失或已删除则拒绝。job from-candidate 验证图片可解码后复制为独立编辑草稿的私有底图并记录来源，不改变原批次失败事实，也不授权定版或启动生成。
candidate favorite 使用 --value true/false 收藏或取消收藏，candidate favorites 查看工程收藏。收藏记录独立保存在工程 favorites.json，绑定源任务、批次和图片身份，不修改需求版本、执行或定版状态；可收藏有效的失败保留图。列表隐藏已删除、丢失或所属任务已归档的图片，源任务改名即时反映。
candidate delete 先确认影响，拒绝运行中或被计划/底图引用的候选；先记删除事实，清理所属文件，并取消关联定版。定版不自动导入游戏或提交 Git。

### 验证和技能

本地先 config validate、doctor、plan/dry，再按授权真实生成与编辑。配置有效、服务可连接与真实出图是不同证据。远程核对实际认证和模型入口；凭证不得写入项目、计划、日志或命令行。
技能由插件清单声明并随包发布，由 Vant 统一分发；不扫描或自动同步其他宿主目录。源码/单测/mock 不能代替真实模型、图像、桌面与安装验证。

任务动态参考先 `job analyze`，缺失、过期或职责越界的观察不能进入生成预案。分析与生成共用任务占用与停止确认。启动回执丢失只能 `task recover --project P --operation ID` 查询唯一原登记；没有唯一证据时保持未知，不能重发生成。

模型、参数及支持状态只在 art 工具 model-catalog/model-registry 内维护，界面与 v-cli 不复制型号判断。远程图片由已注册协议适配器直接调用；视觉分析连接独立，未注入时使用百炼 CLI。Token Plan 是渠道，DashScope 是协议，不跨站点回退凭据。

远端上游身份持久化后才能轮询。`task resume TASK` 只恢复原身份查询与取回，不重发生成；无回执或仍处于 dispatching 的提交保持未知。界面与保存共用 modelEligibility，展示字段不进入执行契约。

风格报告和核心使用 schemaVersion=3，只表达绘制语言，不限定主体题材。低刻画密度不删任务结构，干净笔触不禁止物体纹理，高光画法不统一物理材质。

任务草稿允许内容尚未完成，但拒绝编译器不支持的字段。生成任务的字段正本为 lib/task-contract.mjs；effect 使用 id/kind/target/color/relation/count，不支持 description。先读当前对象，完整保留未修改字段，按当前 revision 保存；保存成功后仍需编译预案，不能声称已生成图片。任务编译错误依据执行回执修正，不猜测风格或尺寸问题。

任务 mustRead 是必须看清的视觉特征，保持字符串数组；画面文字使用独立 textSpecs 数组，每项 content（准确文字）、hierarchy（层级）、zone（位置或载体）必填，fontHint（字形）可选。所有描述完整保存，不设字数上限；草稿允许未填完，预案要求完整。生成任务仅在资产规格允许文字时接受非空 textSpecs，编辑任务按底图及 changes/preserve 执行；不把视觉特征转成文字，不自动开启文字权限。entity.material 是可选物理材质描述。composition.lightDirection/lightQuality 由资产规格成对声明词表及默认值，任务和 variant 可以单项覆盖，未开放能力时携带字段会报错。

job read 返回的 resolvedAsset 是只读有效资产规格，assetError 表示解析失败；更新只提交原 config，不回填投影或默认值。任务对象 schemaVersion=2、风格核心 schemaVersion=3 与计划 compilerVersion=5 相互独立。预案在编译时记录编译版本；读取与执行保持预案及其绑定对象不变。

任务参考可通过 reference import --item-id <对象标识> 绑定单个出图对象；未绑定的参考为任务共用。生成与编辑只采纳共用参考和当前对象参考的观察。reference update 的 itemId 可改绑对象，null 表示任务共用。

`v-cli capability coverage --json` 核对结构化调用覆盖。参考导入的 `--item-id` 指定当前任务出图对象，省略表示任务共用；工具校验对象身份。

### 本地环境部署

使用 environment guide 获取部署指南与契约，environment inspect 读取机器环境。Pi 通过基础工具和动态工作流完成安装、下载、修正与采样；environment verify 独立校验文件、服务和节点，environment register 验收后登记。任务授权、进程、互斥与恢复交由 Harness。不得把模型回复或服务连通当作真实出图。unregister 仅解除登记，不删除模型或停止外部服务。按 --guide 选择随包方案，模型事实和启动参数只由 art 维护。

### 共享风格快照

用户要求共享时使用 style export --project ID --id STYLE --out FILE.style.json，收集当前核心、必要参考和运行时参考，不复制运行记录或设置。style sources --input DIRS.json 只读列出多个来源，单个来源不可用时报告并继续，重复身份内容冲突按来源明确选择。style import --project TARGET --file FILE.style.json 导入固定版本，保留来源身份、版本及核心哈希；不随来源自动更新。导入后可直接编辑保存为本地版本，来源记录与历史快照保留。输出文件不覆盖已有版本。


## 结果验证

核对原始错误、任务身份、停止状态及实际产物。只报告已经完成的验证，模拟测试与真实执行分别说明。

## 参考资料

使用说明（工具包 `README.md`） · 文档规范（工具包 `docs/documentation.md`） · v-cli.plugin.json

## 许可与版权

MIT。Copyright © 2026 Vant。
