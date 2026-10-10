# art 诊断与任务控制

检查分为全局配置、环境、任务编译、请求预演和真实执行五层。前一层通过不能代替后一层；HTTP 服务可达也不能证明 GPU 权重能加载或生成图片。

## 配置和环境

```powershell
v-cli art config show
v-cli art config validate
v-cli art config validate --backend local-qwen
v-cli art doctor --backend local-qwen
v-cli art doctor --backend local-qwen --start
```

config validate 检查字段、模板格式、连接、bindings 和共享执行限制；不遍历所有工程。doctor 检查启动路径、ComfyUI 版本、节点、枚举中的模型和选项及输出索引；不执行全部自定义节点的任意校验逻辑。使用当前配置检查时，冻结任务可能有不同快照，须同时查看其 plan/manifest。

仅指定本机 endpoints，不扫描局域网。doctor 不可达时默认退出 1 并提示 --start。--start 可能懒启动；启动失败看返回 issues、嵌套 diagnostic 和 .runtime 中服务日志，检查完可 shutdown。编辑图的 LoadImage 占位值跳过已有图片枚举检查，因为实际输入会上传。

远程 doctor 只检查配置。检查百炼安装用 bl --help，认证用 bl auth status，生效区域/URL 用 bl config show；当前安装没有 bl doctor。只读检查不能保证云端联网、额度和模型实际可用，需在任务授权范围内验证真实调用。

## 工作流错误结构

```powershell
v-cli art task status TASK
v-cli art task wait TASK --timeout 60
```

本地环境不兼容、工作流提交拒绝和采样异常分别记录 diagnostic.stage=environment/submission/execution。task 状态、前台等待结果和 manifest 提供错误；单体失败记录也保留 diagnostic。

| 字段 | 读取方式 |
|---|---|
| kind/stage | 是否工作流相关，失败发生在哪一层 |
| backend/workflow | 任务实际冻结的后端与模板身份 |
| promptId | ComfyUI 已接受的执行 ID；提交前失败可能没有 |
| nodes | 提交校验节点 ID/类型/title/errors，或执行异常节点、异常类型、信息和 traceback |
| environments | 环境不兼容时的 endpoint、版本和缺失节点/模型 issues |
| messages | ComfyUI 返回的历史执行消息 |
| hint | 辅助修复建议，以原始错误为依据 |
| unsettled | 无法确认后端已经停止；不能宣称回收完成 |

启动入口、网络、上传或输出数量错误不一定有节点 diagnostic，应读取 error、logPath 和 manifestPath。ComfyUI 接受 promptId 同时报告节点错误时，art 先请求停止该 prompt，再记录失败，避免遗留执行。

## 按原因处理

| 现象 | 检查与处理 |
|---|---|
| configuration/workflow_format | 修复字段；导出 API JSON，而非画布 nodes/links |
| workflow_link/workflow_binding | 对照节点 ID、input 名和输出索引；不要只看中文标题 |
| missing_node | 安装或修复相关 ComfyUI 插件，重启服务后 doctor |
| missing_model/invalid_node_value | 核对模型文件名、目录及节点实际可选值；检查执行 model 覆盖 |
| comfyui_version | 升级到支持按 prompt_id 中断的版本，至少 0.39.0 |
| launch_path/launch_entry/startup | 核对 executable/cwd/args、端口和服务日志；不能用端口占用证明服务兼容 |
| CUDA OutOfMemory/内存不足 | 降低尺寸或候选工作负载，确认 lowvram 与 CPU 编码配置；重新 plan |
| 只输出零张或多张图片 | 模板每次须恰好一张最终 output；检查 SaveImage 和 batch_size |
| 原图或计划哈希变化 | 从当前任务和原图重新 plan，不手改哈希或 frozen plan |
| 远程调用失败 | 检查百炼入口、凭证、区域、模型限制和任务日志；不自动换模型或后端 |

修复模板或配置后重新 plan、run --dry，再在授权范围内重试。检查结果不自动选择替代模型、不改设计尺寸、不下载权重。

## 单次任务生命周期

| 状态 | 含义与后续 |
|---|---|
| queued | 工作进程已提交，等待运行 |
| running | 可能正在启动服务、等串行锁、加载或采样；查看 currentItem/promptId |
| succeeded | 所选任务完成；进入人工审查 |
| failed | 执行失败；读取 error/diagnostic/manifest；可能已有部分图片 |
| cancelled | 当前任务已取消；查看已完成产物与远程取消说明 |
| lost | worker 死亡且状态过期；后端可能仍在执行，需要 cancel/shutdown |

后台任务不会因终端窗口关闭自动取消。task wait 只等待；--timeout 超时后仍可 status/wait/cancel。task cancel 请求指定任务停止，保留服务；已完成任务会返回原终态。部分图片保留，不自动删除。

## shutdown 的完整语义

```powershell
v-cli art task cancel TASK
v-cli art shutdown
```

cancel 针对一个 art 任务；shutdown 针对当前 --config 识别的全部 art 生图/编辑任务，以及配置和历史冻结任务引用的本地后端：阻止新提交、请求取消、清空队列、全局中断、等待停止、关闭核验后的服务进程。后端上浏览器或其他客户端的任务也会被清空/中断。同步 style analyze 不属于该队列。

关闭前核对 PID、创建时间和命令身份。art 启动的服务保存身份；Windows 可定位与 launch.executable 和入口匹配的已有实例。其他平台无法核验的外部进程不能宣称已回收。未确认停止或关闭失败则返回错误；读取失败信息再处理，不广泛终止所有 Python 进程。

远程取消终止本地 bl 调用，不保证云端请求停止或费用撤销。remoteCancellation 字段与 shutdown.remoteCancellationUnconfirmed 提供这个边界；不能把本地 cancelled 当作云端已取消。
