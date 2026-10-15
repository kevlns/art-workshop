# 任务控制与诊断

## 先核对事实

先 config validate，再 doctor；远程 doctor 只核对配置，不验证认证、账号授权或云端连通性。本地 doctor 默认不启动、不采样；--start 可启动并保留服务。真实生成仍须 plan/dry 和任务授权。

技术检查不证明画面质量；mock 不证明模型真实出图；服务可连接不证明显存足够；包构建不证明安装及桌面交互通过。

## 状态与占用

task status 返回原运行阶段、心跳、工作进程、后端身份、manifestPath、错误和停止证据。queued/running/cancelling 仍占用对象。释放必须是已知终态、stopConfirmed=true，且无 unsettled、promptId、remoteCancellation 或 dispatching/accepted 远程回执；unknown 一律保留占用。

分析阶段记录 reference-analysis（当前图片与已完成数量）、synthesis（汇总）、report-repair（一次格式修正）和 report-validation（校验回填），不会用心跳推测完成比例。模型响应文字按调用保存在对象 reports/<taskId>/responses/，不保存凭据或请求图片编码。格式校验失败最多基于已有结果修正一次，不重复读取已完成的图片；仍失败则保留原响应和草稿，明确显示错误。

工作进程丢失且心跳过期标记 unknown，不能推测上游停止。task wait 超时不取消；切面板不取消；本地客户端退出不代表云端取消或费用撤销。

## 查询、恢复和重试

| 情况 | 入口 | 行为 |
| --- | --- | --- |
| 已知 taskId | task status / task wait | 查询原运行 |
| 启动回执丢失 | task recover --project P --operation ID | 唯一原登记查找；不启动进程 |
| 已有 accepted/completed 远程回执 | task resume TASK | 原 taskId 继续查询与下载，不发生成 POST |
| dispatching 中断但无上游 ID | 保留未知，核对原提供方记录 | 不允许猜测恢复或重发 |
| 上游完成但下载失败 | task resume TASK | 取回原结果，不付费重生成 |
| 明确失败且停止确认 | run --plan FILE --retry-run RUN | 新批次只重试明确失败项，记录 retryOf |
| 风格采用事务中断 | style recover | 完成原事务，不重新冻结另一份核心 |
| 部署启动回执丢失 | deployment recover --operation ID | 只读恢复唯一登记 |

resume 要求原工作进程已退出、运行终态、回执和冻结请求哈希一致。跳过成功文件、上游失败或取消项，不补发未提交项。无回执、身份不符或无可查询/取回项目均拒绝。查询失败保留原 ID；当前不自动重发提交或自动重试查询。

retry-run 不能混用 dry/item/variant/offset/limit；原批次和先前重试必须停止确认，成功项不重复执行，远程完成待下载项不能走重生成。配置、模型契约、规格、核心、参考、底图或工作流变化后重编译，不能运行过期预案。

## 取消与关闭

task cancel 定向取消本工作区运行。本地按 promptId 处理自有请求，保留 ComfyUI 服务；远程无已适配上游取消能力时只停止本地等待，保留原身份与未知停止事实。

CLI shutdown 阻止新提交，停止当前工作区关联任务，再核验共享队列及服务进程身份。它不清空共享队列；存在其他运行/排队请求、停止未知或身份不可验证时保留服务。不要广泛杀所有 Python。

Vant 应用退出有独立所有权清理：关闭 Vant 启动并登记的后台进程和 ComfyUI，检查端口释放，不把外部用户服务收编为退出时终止目标。窗口关闭、CLI shutdown、应用退出三个入口的作用域不同。

## 常见配置问题

- 模型无法选择：依次核对实例/模型启用、目录可用、凭据、输出能力、图片协议、准确型号及模式支持。仅登记型号显示限制原因，不可执行；手工能力覆盖不能绕过缺失的协议适配。
- 报告过期或 revision 冲突：重新读取对象及版本，不覆盖用户输入；更新后重新分析或预演。
- 模型已存在仍提示部署：核对选择的是便携根目录、文件准确名称与大小，再做 SHA256 和能力接入；不以文件存在替代完整环境验证。
- 端口被占：区分原环境和其他程序，修改端口后重新检测；自动选择端口不等于长期预约。
- 候选删除清理失败：保留删除事实，仅重试所属文件清理，不恢复成可用候选。
