# 美术工坊

面向游戏资产的风格分析、图片生成与编辑工具。风格和任务按工程隔离，计划可预演，执行可追踪，候选按资产定版。产品流程只有「生成 → 定版」；完整性检查不会引入人工评分阶段。

通过 `v-cli art` 使用，或直接运行 `art-workshop`。需要 Node.js >=20.9。安装不会创建工程、下载模型或生成图片；安装脚本会同步已有 Agent 技能目录中的随包技能。

```sh
npm install -g @kevlns/v-cli
v-cli agent docs art
v-cli agent describe art --json
v-cli art config show
v-cli art agent index
v-cli art config validate
```

## 使用流程

1. 创建 schemaVersion 2 工程和风格草稿，导入对象私有参考；分析预演后按授权运行，审阅报告并采用为冻结核心。
2. 用 `job template` 获取任务模板，填写实际需求后创建任务。动态参考先 `job analyze`；编辑底图单独绑定。
3. 编译 `generate plan` 或 `edit plan`，保存并用 `run --plan ... --dry` 核对模型、尺寸、候选数、输入和参数转换。
4. 按任务授权执行，保存 taskId；前台和后台都登记运行。查询原身份，不因超时或重启重复提交。
5. `check` 核验产物，`candidate finalize` 定版。替换需 `--replace`，删除需 `--confirm`，均保留事实记录。

正式风格只读，修改需派生。任务空闲后可按原身份更新配置，历史批次不覆写。状态优先级为待定版、执行中、已定版、草稿；运行状态与停止证据分别判断，不能只看终态释放占用。

## 后端与数据归属

本地为 ComfyUI 内置 Qwen Image 2.1 Q4、CPU 文本编码器方案，支持生成和显式底图编辑。自定义 API workflow 需要明确 bindings 与完整适配，不能把任意导入工作流视为可执行。

远程图片通过工具登记的协议适配器直接调用，目前登记 DashScope。模型、参数与支持状态由 art 内部登记表维护，Vant 读取同一目录，不复制型号判断。分析使用独立视觉模型连接；未注入视觉连接时使用百炼 CLI。Token Plan 是渠道，DashScope 是协议，不能据协议擅自替换实例地址和凭据。

应用数据根默认 `~/.vant`，可由 `VANT_HOME` 覆盖。工具配置为 `~/.vant/tools/art-workshop/config.json`；Vant 将工程美术数据绑定至工程 `.vant/art`。共享模型环境默认 `~/.vant/art-env`，控制状态与日志归用户数据根；安装根保存环境标记 `vant.art.config.json`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [模式与流程](docs/modes.md) | 分析、生成、编辑及定版 |
| [配置](docs/configuration.md) | 路径、后端、连接与凭据边界 |
| [数据结构](docs/data-formats.md) | 工程、对象、计划、运行与回执 |
| [命令参考](docs/commands.md) | 从插件清单生成的完整命令与选项 |
| [本地部署](docs/deployment.md) | 已有环境复用、部署预案与进度 |
| [任务控制与诊断](docs/troubleshooting.md) | 取消、恢复、重试和关闭 |
| [远程图片适配](docs/remote-models.md) | 支持范围、参数限制和筛选 |
| [模型架构](docs/model-architecture.md) | 登记、适配器和扩展规范 |
| [核心冻结](docs/core-guidance.md) | 风格与需求的职责边界 |

开发校验：`npm run docs:generate`、`npm run check`、`npm run test:package`。模拟测试、配置有效和服务可连接都不能代替真实出图；文档更新不代表新包已发布或桌面安装已更新。
