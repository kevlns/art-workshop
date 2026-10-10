# art 命令参考

所有 art 命令均可通过 v-cli art 调用。本页按 0.2.1 协议整理；实际完整参数先运行 v-cli agent describe art --json。CLI 查询和检查主要输出 JSON，不需要额外 --json；--json 属于 v-cli agent 的发现命令。--version 与 --help 单独使用。

## 公共目录参数

--config FILE、--workspace DIR、--output-dir DIR、--refs-dir DIR、--cache-dir DIR 临时选择用户配置和目录。路径基准见 configuration.md。配置未声明字段或参数重复时拒绝，不用兼容入口代替。

## 命令与检查规范

| 命令 | 必需身份或文件 | 主要选项与调用要求 |
|---|---|---|
| help / --help | 无 | 只显示入口，不读取配置 |
| --version | 无 | 只显示版本，不读取配置 |
| config path | 无 | 返回配置路径；配置需能解析 |
| config show | 无 | 返回生效路径、后端及默认项 |
| config init | 无 | 创建默认文件；已有不覆盖 |
| config validate | 无 | --backend ID 可限定；校验全局配置与模板，失败退出 1 |
| doctor | 无 | --backend ID 可限定；--start 可启动本地服务，不采样 |
| workflow list | 无 | 返回内置名称和 API/UI 路径；不依赖用户配置合法性 |
| refs guide | 无 | --project P 可选，--refs-dir 可覆盖；显示实际分类与 scope |
| list | 无 | 列出外部工程，不是旧风格包列表 |
| agent index | 无 | 返回工程、核心、任务、模块、入口与外部路径 |
| agent docs | 无 | 输出随包完整指南 |
| agent init | 无 | --directory DIR 指定已存在目录；--dry 预览同步 |
| style analyze | --project P、--input FILE | --out REPORT、--dry；非 dry 可调用远程分析 |
| style validate | --project P、--report REPORT | 校验报告、推荐核心、冲突及不确定项 |
| style freeze | --project P、--report REPORT | --note TEXT；用户采用后冻结，不覆盖已有核心 |
| style show | --project P、--core CORE | 读取并核对冻结身份与哈希 |
| generate show | --project P、--job J | 展示源任务，不是编译后的最终请求 |
| generate plan | --project P、--job J | --core CORE、--backend ID、--out PLAN |
| generate run | --plan PLAN，或 --project P、--job J | 选择、预演及后台参数见下文 |
| edit show | --project P、--job J | 展示底图与修改、保留要求 |
| edit plan | --project P、--job J | --core CORE、--backend ID、--out PLAN；核对 source 哈希 |
| edit run | --plan PLAN，或 --project P、--job J | 编辑适配器须支持原图；与 generate 同一任务机制 |
| task list | 无 | 当前配置范围内运行记录；不等于所有 ComfyUI 浏览器任务 |
| task status | TASK | 状态、日志、manifest、diagnostic；失联任务可被标记 lost |
| task wait | TASK | --timeout SECONDS，默认 3600；超时不取消任务 |
| task cancel | TASK | 请求停止并等待最多 60 秒；保留服务 |
| shutdown | 无 | 停止当前范围全部任务、清空关联后端队列、关闭服务 |
| check | RUN，或 --file RUN | --out REVIEW、--review REVIEW；汇总完整性和人工审查 |
| select | RUN、--item ITEM、--variant VARIANT | --review REVIEW、--file IMAGE；必须选唯一且全通过的图片 |
| compare | PLAN_A PLAN_B | 比较计划/manifest 的计划快照，不分析图片 |

省略 --project 时可使用 defaultProject，但示例推荐显式指定。TASK/RUN/PLAN 等均为占位符，替换后再运行。

## run 的两种来源

```powershell
# 根据当前来源重新编译，可以选后端。
v-cli art generate run --project P --job J --backend local-qwen --item ITEM --dry
# 使用冻结计划，只选执行项，不调整来源。
v-cli art generate run --plan .cache/local-plan.json --item ITEM --variant base --background
```

使用 --plan 时禁止 --project、--job、--core、--backend、--explore。允许 --item、--variant、--offset、--limit、--dry、--background，以及公共路径覆盖。新来源调用可加 --explore 执行全部 variants；默认只选 base。--variant 为单一候选 ID；--limit/--offset 按 item ID 计数，limit 为正整数，offset 为非负整数。

--dry 显示请求，不创建 task、上传原图、联网或采样。--background 返回 taskId；前台创建同样任务并等待。run 不支持用 --timeout 改等待或采样时间，应单独使用 task wait 或修改后端 timeoutSeconds 后重新 plan。

## 退出码和产物

config validate/doctor 检查通过为 0，失败为 1；远程 doctor 的 0 只代表配置检查。后台 run 的 0 只表示成功提交工作进程，任务结果看 task status/wait。前台 run 和 task wait 遇到非 succeeded 终态返回 1；等待超时也返回错误，但后台任务继续。task status 是查询，failed 状态并不意味着查询命令本身失败；task cancel 返回取消后的记录，也可能返回已完成终态，应检查 status/unsettled。

检查或编译失败不产生图片。实际任务文件位于配置旁 .runtime，生成目录在 output。取消或失败可能留下已生成图片与 manifest，不能把文件存在当作验收通过。

## 副作用范围

| 操作 | 网络、进程与写入 |
|---|---|
| help/version/workflow list | 无服务启动、模型请求或 refs 初始化 |
| config validate | 读取配置和模板，不探测 HTTP、不补 refs |
| doctor | HTTP 环境查询；默认不启动、不采样、不补 refs |
| doctor --start | 可写服务状态/日志并启动；检查后服务保留 |
| 普通查询、plan、run --dry | 可补齐外部 refs 分类；plan --out 写计划；不调用生图服务 |
| style analyze | 非 dry 可远程调用、写缓存/报告；不自动冻结 |
| style freeze | 写核心和 project.json；需采用报告；可同步 skill |
| 非 dry run | 启动任务进程、保存产物；本地可懒启动和采样，远程可产生费用；可同步 skill |
| task status/list/wait | 读状态；发现死 worker 时可写 lost；普通 CLI 仍可能补 refs |
| task cancel/shutdown | 请求取消，按范围操作队列或进程，写状态；shutdown 范围更广 |
| check/select/agent init | 检查或写审查、选择、技能文件；不调用模型 |

--dry 不是所有命令的通用零副作用开关，只在明确支持的 analyze/run/agent init 中有意义。不要把命令未使用的参数当作模式切换。
