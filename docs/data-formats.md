# Vant art 工程与输入结构

## 定位

art 工程与输入结构，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 字段与示例

### 工程和对象

project.json 必须声明 schemaVersion=2、revision、id、name、analysisModel、execution、cores、defaultCore。工程身份与目录匹配，核心必须属于同一工程。

projects/<projectId>/styles/<styleId>/style.json 与 tasks/<taskId>/task.json 使用 schema=art-workshop/style 或 art-workshop/task，schemaVersion=2、稳定 id、project、展示 name、revision、status、createdAt/updatedAt、config、references 和 report。正式风格的 core.json 不可原地覆写。任务的 config.kind 是 generate/edit，不能改身份与类型。

参考记录包括 id、所属对象、对象内相对 path、SHA256、来源、category/purposes、usage、note、ignore。风格三类：style、palette、rendering。任务用途：subject、composition、pose、identity-color、surface、scene-light、text。sources 只放编辑底图。

### 需求与计划

生成 config 包括 project、kind、core、execution、items，以及互斥的 profile 或内联 asset 规格；实体及效果有稳定 id、数量、颜色、角色与关系。具体主体、构图、动作不冻结进风格。规格定义资产约束、设计基准与检查要点，内联规格属于当前任务，编译时形成同一不可变快照。编辑 config 的 items 明确 source、changes、preserve、mustRead、seed。

plan 包括 schema=art-workshop/plan、module/project/job、sources、snapshots、refs、execution、items、planHash。sources 绑定 taskRevision、taskConfigHash 和 coreHash；项目/核心/profile/任务形成快照。项含 inputHash、实际尺寸和 seed。任何来源或哈希变化拒绝运行。

### 执行与定版

对象 taskId（命令中称 job/id）与执行 taskId 是两种身份；每次真实执行有独立登记。运行记录包含 queued/running/cancelling/succeeded/failed/cancelled/unknown、heartbeat、workerPid、后端身份、manifestPath、stopConfirmed 与 unsettled。终态与停止证据独立；没有停止证据继续占用对象。配置状态及界面分组不能取代运行身份。

manifest 保存计划、每项输出及哈希、失败证据和完成事实。候选身份绑定运行、资产、构图与文件。定版记录保留资产、候选、批次、哈希、操作者与时间；替换与删除进入历史。删除先记录事实，物理清理可重试。

远程计划项的 request 使用 art/image-request-v1，executionContract 使用 art/execution-contract-v1。执行记录 remoteExecutions[inputHash] 保存 art/remote-receipt-v1，状态为 dispatching/accepted/completed/failed/cancelled；包含适配器版本、requestHash、baseUrl 及可用的 taskId/urls。dispatching 先于提交，accepted 先于轮询，completed 先于下载；不含密钥。具体字段以 lib/contracts.d.ts 及编译结果为准，不手工拼装执行回执。

task recover 根据工程和 operationId 找回唯一原执行；task resume 沿用原执行和 manifest，仅处理已有上游身份。retry-run 则创建新批次并记录 retryOf。三种身份流不能混用，详见 [任务控制](troubleshooting.md)。





风格报告与 core.json 使用 schemaVersion=3。recommendation.rules 保存带主题、强度和条件的定性规则，issues 保存具体决策选项，decisions 保存已确认取舍，notes 保存不阻塞的提醒。style list/read 返回 review（ready、stale、openIssues、reason、有效 recommendation）及 compatibility。对象存储使用 schemaVersion=2。详细字段见 core-guidance.md。

## 执行边界

字段、路径与权限以当前 schema、运行时校验和明确授权为准；配置有效不等于外部服务已执行成功。

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
