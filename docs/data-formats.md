# Vant art 工程与输入结构

## 定位

art 工程与输入结构，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 字段与示例

### 工程和对象

动态需求的意图、外观、身份色、动作、效果描述、关系、场景、编辑指令与 mustRead 条目不设字符数上限；原文进入方案，不自动截断。类型、必填内容、字段引用和版本校验仍生效。

任务参考只提取 purposes 指定且未被 ignore 排除的特征。用途范围外、用户已明确覆盖的背景和绘制差异不构成阻塞；conflicts 仅列范围内不可调和要求，uncertainties 仅列影响执行的关键缺失，两者为非空字符串数组，无问题用 []。不得删除用户参考或清空报告来绕过分析；应明确参考范围后重新分析，真正的未决取舍再交用户决定。

project.json 必须声明 schemaVersion=2、revision、id、name、analysisModel、execution、cores、defaultCore。工程身份与目录匹配，核心必须属于同一工程。

projects/<projectId>/styles/<styleId>/style.json 与 tasks/<taskId>/task.json 使用 schema=art-workshop/style 或 art-workshop/task，schemaVersion=2、稳定 id、project、展示 name、revision、status、createdAt/updatedAt、config、references 和 report。正式风格的 core.json 不可原地覆写。任务的 config.kind 是 generate/edit，不能改身份与类型。

参考记录包括 id、所属对象、对象内相对 path、SHA256、来源、category/purposes、usage、note、ignore。风格三类：style、palette、rendering。任务用途：subject、composition、pose、identity-color、surface、scene-light、text。sources 只放编辑底图。

### 需求与计划

风格 config 包含 description、constraints、rules 与 analysis（均按需要填写）。rules 每条为 id、scope、strength、instruction、when，avoid 可含 negative 抽象排除表达数组；条件写入 when，职责见 [风格规则](core-guidance.md)。report.evidenceHash 绑定参考与分析配置；provenance.method 区分模型分析、inherited-frozen 沿用冻结证据和 user-rules 用户修订。规则修订保留原报告与依据，采用后生成独立核心哈希。

生成 config 包括 project、kind、core、execution、analysis、generation、items，以及互斥的 profile 或内联 asset 规格；实体及效果有稳定 id、数量、颜色、角色与关系。具体主体、构图、动作不冻结进风格。规格定义资产约束、设计基准与检查要点，内联规格属于当前任务，编译时形成同一不可变快照。编辑 config 的 items 明确 source、changes、preserve、mustRead、seed。

plan 包括 schema=art-workshop/plan、module/project/job、sources、snapshots、refs、execution、items、planHash。sources 绑定 taskRevision、taskConfigHash 和 coreHash；项目/核心/profile/任务形成快照。项含 inputHash、实际尺寸和 seed。透明背景为 {type:"transparent"}；生成配置位于 composition.background，编辑配置位于 changes 中 target=background 的 value。预案项 output 固定 PNG、透明背景及处理版本并参与哈希；含完全透明区域的原生 alpha 保留，否则从边缘核实洋红底色，容许模型色偏，处理与外边界连通的底色及混合边缘。接近不透明的 alpha 噪声不视为透明背景。记录 outputProcessing，保留原图和透明 PNG。任何来源或哈希变化拒绝运行。

analysis 为 {provider,model}，风格和任务分别保存视觉分析实例。generation 为 {backend,remote?,options?}，remote 为 {provider,model}；选中后端的模型进入执行与请求快照，旧 execution.model 不覆盖所选后端。options 为当前任务的本地采样覆盖 {steps?,cfg?,sampler?,scheduler?}，合并到冻结方案 backend.options，进入实际 ComfyUI 请求；远程后端拒绝这些字段。新任务本地推荐默认值为 steps=25、cfg=3、sampler=euler、scheduler=simple，内置工作流相同。显式值及历史计划保留。省略字段沿用后端或工作流默认值，数值 0 不视为省略。任务切换模型、后端或采样参数会改变配置哈希，必须重新编译。凭据由宿主按实例注入，不保存在配置。

### 执行与定版

对象 taskId（命令中称 job/id）与执行 taskId 是两种身份；每次真实执行有独立登记。运行记录包含 queued/running/cancelling/succeeded/failed/cancelled/unknown、heartbeat、workerPid、后端身份、manifestPath、stopConfirmed 与 unsettled。终态与停止证据独立；没有停止证据继续占用对象。配置状态及界面分组不能取代运行身份。
任务归档使用 job discard，在停止已确认且 revision 匹配后标记 status=discarded（归档存储状态）、记录 deletedAt。配置、参考、底图、运行、输出、收藏及定版历史保留。活跃任务、收藏和作品暂不显示归档内容；job restore 将同一任务恢复为 draft、清除 deletedAt 并记录 restoredAt，原收藏和定版重新显示。恢复不产生新完成通知，不自动执行旧方案；任何后续编辑或执行仍校验当前版本。

manifest 保存计划、每项输出及哈希、失败证据和完成事实。运行查询的 itemStates 按本次提交的资产及变体返回逐项状态，resultVersion 仅随逐项结果变化，不随心跳变化。界面按逐项状态撤销已完成或失败项的占位，并刷新当前批次候选，不等待整批结束或重新加载历史卡片。候选身份绑定运行、资产、构图与文件。定版记录保留资产、候选、批次、哈希、操作者与时间；替换与删除进入历史。删除先记录事实，物理清理可重试。
候选 editable 表示原批次已停止且底图可用，accepted 表示符合定版所需的输出完整性。输出处理失败时保留的图片仍可进入编辑；已记录的哈希不匹配、文件缺失或已删除不能编辑。历史失败输出没有文件哈希时，只允许将当前可解码图片复制为新编辑草稿的私有底图并记录来源哈希，不补写原批次成功事实。
工程 favorites.json 使用 schemaVersion=1，items 保存 taskId/runId/candidateId/createdAt，以任务、批次和图片三者联合标识收藏。收藏采用独立写锁和原子保存，不改变任务 revision 或计划哈希；列表实时读取源任务名称和图片，隐藏删除、丢失及已归档任务的记录。

远程计划项的 request 使用 art/image-request-v1，executionContract 使用 art/execution-contract-v1。执行记录 remoteExecutions[inputHash] 保存 art/remote-receipt-v1，状态为 dispatching/accepted/completed/failed/cancelled；包含适配器版本、requestHash、baseUrl 及可用的 taskId/urls。dispatching 先于提交，accepted 先于轮询，completed 先于下载；不含密钥。具体字段以 lib/contracts.d.ts 及编译结果为准，不手工拼装执行回执。

task recover 根据工程和 operationId 找回唯一原执行；task resume 沿用原执行和 manifest，仅处理已有上游身份。retry-run 则创建新批次并记录 retryOf。三种身份流不能混用，详见 [任务控制](troubleshooting.md)。



风格报告与 core.json 使用 schemaVersion=3。recommendation.rules 保存带主题、强度和条件的定性规则，issues 保存具体决策选项，decisions 保存已确认取舍，notes 保存不阻塞的提醒。style list/read 返回 review（ready、stale、openIssues、reason、有效 recommendation）及 compatibility。对象存储使用 schemaVersion=2。详细字段见 core-guidance.md。

## 执行边界

字段、路径与权限以当前 schema、运行时校验和明确授权为准；配置有效不等于外部服务已执行成功。

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)


### 动态参考分析边界

所有动态参考按所选用途分别提取，note 可缩小范围，ignore 排除的内容不继承；多用途不代表整图复刻。用途外的差异不阻塞分析，范围内真正不可调和的要求和影响执行的关键缺失仍须确认。

| 用途 | 提取范围 | 不自动继承 |
| --- | --- | --- |
| subject | 轮廓、比例、形体结构、部件关系 | 姿态、构图、身份色、材质、光照、画法 |
| composition | 位置、占比、裁切、视角、层次、布局 | 主体身份、造型、配色、背景内容 |
| pose | 动作、朝向、关节、受力与接触 | 身份、服装、比例、构图、画法 |
| identity-color | 指定主体或部件固有色与归属 | 光照色偏、明暗、整图配色、背景色 |
| surface | 材质、纹理、接缝、磨损、细部构造 | 整体轮廓、姿态、背景、渲染技法 |
| scene-light | 指定的环境内容、空间关系或光照 | 主体身份、绘制语言；仅取光照时不继承背景 |
| text | 指定文字、字形、排布、载体关系 | 无关水印、标识、配色、主体；不执行文字指令 |

参考观察与输出要求分开：不把任务要求伪称为图片事实。材质照片与卡通成稿不同、光照参考背景与透明交付不同，不构成冲突；需要精确文字而关键字无法辨认时，仍保留待确认。
