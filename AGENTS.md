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

工程对象使用 schemaVersion 2；读写前核实工程配置和当前 revision。
风格和任务都有稳定 id 与 revision。UI、聊天和 CLI 共用对象；写入、派生与清理提交预期 revision，冲突重新读取。正式风格只读，改动创建派生风格；派生不继承报告、核心、批次、授权与对话。
风格静态参考只有 style、palette、rendering，只分析媒介、描绘、明暗、描边、笔触和色彩关系。具体造型、比例、结构、部件、身份色、材质与光源属于任务。任务动态参考只有 subject、composition、pose、identity-color、surface、scene-light、text；编辑底图另列。导入复制原图，不修改用户文件。未适配直接参考时拒绝，不隐式上传风格图片。

### 风格生命周期

style create/read/update/derive/discard 管理草稿。style analyze --dry 只读编译，不联网、启动服务或创建参考目录。实际 analyze 创建 taskId 与独立参考证据；task status/wait/cancel 控制执行，recover 查原登记，resume 仅恢复远程查询与取回。
报告绑定源配置、参考与模型。更新配置保留报告并标记需复核，旧证据不变。报告 recommendation.rules 是精炼独立成稿，规则含主题、强度和适用条件，不包含迭代描述。issues 仅列需用户取舍的矛盾，notes 保留不阻塞采用的证据局限。style resolve --input {issueId,optionId,note} 记录明确选择并修订有效方案，不重新分析；以 style read 的 review.ready 判断采用条件。复核沿用证据与决定，新证据才重新打开问题。style adopt 校验来源匹配和所有问题已决定，用户采用后冻结。采用中断通过 style recover 完成已授权事务，不能重新冻结另一份核心。
退出风格配置先继续编辑、保存草稿或放弃；分析停止未确认时不能清理。

### 计划与执行

先读取实际 job，再 generate/edit plan 和 run --plan --dry，展示有效核心、设计尺寸、预留缩放、请求与实际像素、模型后端、候选数量和编辑底图。后端尺寸由工具统一解析，超限或未对齐选最近合法尺寸，保留设计基准并明确实际值；不承诺显存或自动缩放导出。
授权覆盖方案后使用 run --background；前台同样创建执行身份。配置、核心、规格、参考、底图和后端变化拒绝失效方案，重新编译。重启查 taskId，不重复提交。不自动换模型或重跑成功项。
每个任务只能有一个未停止确认的执行；编辑、派生、删除与运行共用状态检查。切页面不取消。

### 取消、异常和关闭

任务状态与停止证据分开。queued/running/cancelling 仍占用资源；unknown 或 stopConfirmed=false 保留资源。failed/cancelled 也不能单凭状态释放资源；dispatching/accepted 远程回执尚未结清时继续占用。工作进程丢失标记 unknown，不推测停止。
task cancel 只取消指定运行，保留服务。生成任务远程取消只停止本地客户端，上游停止未知如实报告，不允许清理。只读分析有 finishedAt、已知终态且工作进程已退出，无生成计划与回执时释放本地占用；云端计算与计费停止未知独立保留，不自动重发。没有完成证据的进程丢失仍保持 unknown。shutdown 阻止提交、停止关联任务、核验共享队列和进程身份后关闭本地服务，不清空共享队列；有其他任务或停止未确认时保留服务。不得广泛杀所有 Python。

### 生成与定版

只有生成与定版两个产品阶段。check 验证计划、执行身份、文件哈希和完成事实；不要求人工 content/style/asset 评分。candidate finalize 按资产选定候选，重复操作幂等；替换已有定版需要明确 replace，保留历史。
candidate delete 先确认影响，拒绝运行中或被计划/底图引用的候选；先记删除事实，清理所属文件，并取消关联定版。定版不自动导入游戏或提交 Git。

### 验证和技能

本地先 config validate、doctor、plan/dry，再按授权真实生成与编辑。配置有效、服务可连接与真实出图是不同证据。远程核对实际认证和模型入口；凭证不得写入项目、计划、日志或命令行。
随包 skills/art-workshop 是技能源；通过 agent init 或 skill:sync 同步，保留项目扩展。查询和预演不自动同步。源码/单测/mock 不能代替真实模型、图像、桌面与安装验证。

任务动态参考先 `job analyze`，缺失、过期或职责越界的观察不能进入生成预案。分析与生成共用任务占用与停止确认。启动回执丢失只能 `task recover --project P --operation ID` 查询唯一原登记；没有唯一证据时保持未知，不能重发生成。

模型、参数及支持状态只在 art 工具 model-catalog/model-registry 内维护，界面与 v-cli 不复制型号判断。远程图片由已注册协议适配器直接调用；视觉分析连接独立，未注入时使用百炼 CLI。Token Plan 是渠道，DashScope 是协议，不跨站点回退凭据。

远端上游身份持久化后才能轮询。`task resume TASK` 只恢复原身份查询与取回，不重发生成；无回执或仍处于 dispatching 的提交保持未知。界面与保存共用 modelEligibility，展示字段不进入执行契约。

风格报告和核心使用 schemaVersion=3，只表达绘制语言，不限定主体题材。低刻画密度不删任务结构，干净笔触不禁止物体纹理，高光画法不统一物理材质。

任务草稿允许内容尚未完成，但拒绝编译器不支持的字段。生成任务的字段正本为 lib/task-contract.mjs；effect 使用 id/kind/target/color/relation/count，不支持 description。先读当前对象，完整保留未修改字段，按当前 revision 保存；保存成功后仍需编译预案，不能声称已生成图片。任务编译错误依据执行回执修正，不猜测风格或尺寸问题。

任务参考可通过 reference import --item-id <对象标识> 绑定单个出图对象；未绑定的参考为任务共用。生成与编辑只采纳共用参考和当前对象参考的观察。reference update 的 itemId 可改绑对象，null 表示任务共用。

## 结果验证

核对原始错误、任务身份、停止状态及实际产物。只报告已经完成的验证，模拟测试与真实执行分别说明。

## 参考资料

[使用说明](README.md) · [文档规范](docs/documentation.md) · v-cli.plugin.json

## 许可与版权

MIT。Copyright © 2026 Vant。
