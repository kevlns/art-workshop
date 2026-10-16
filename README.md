# Vant 美术工坊

`@kevlns/art-workshop`

## 功能

管理项目风格、参考图、图片生成、编辑和定版。支持本地 ComfyUI 与远程图片模型。

## 环境要求

Node.js 20 及以上；本地生成还需工具检测通过的 Python、显卡驱动与 ComfyUI 环境。

## 安装

```sh
npm install -g @kevlns/art-workshop
```

## 快速开始

```sh
art-workshop config show
art-workshop config validate
art-workshop agent index
```

## 使用说明

### 使用流程

1. 创建 schemaVersion 2 工程和风格草稿，导入对象专属参考；分析预演后按授权运行，审阅报告并采用为冻结核心。
2. 用 `job template` 获取任务模板，填写实际需求后创建任务。动态参考先 `job analyze`；编辑底图单独绑定。
3. 编译 `generate plan` 或 `edit plan`，保存并用 `run --plan ... --dry` 核对模型、尺寸、候选数、输入和参数转换。
4. 按任务授权执行，保存 taskId；前台和后台都登记运行。查询原身份，不因超时或重启重复提交。
5. `check` 核验产物，`candidate finalize` 定版。替换需 `--replace`，删除需 `--confirm`，均保留事实记录。

正式风格只读，修改需派生。任务空闲后可按原身份更新配置，历史批次不覆写。状态优先级为待定版、执行中、已定版、草稿；运行状态与停止证据分别判断，不能只看终态释放占用。

### 后端与数据归属

本地为 ComfyUI 内置 Qwen Image 2.1 Q4、CPU 文本编码器方案，支持生成和显式底图编辑。自定义 API workflow 需要明确 bindings 与完整适配，不能把任意导入工作流视为可执行。

远程图片通过工具登记的协议适配器直接调用，目前登记 DashScope。模型、参数与支持状态由 art 内部登记表维护，Vant 读取同一目录，不复制型号判断。分析使用独立视觉模型连接；未注入视觉连接时使用百炼 CLI。Token Plan 是渠道，DashScope 是协议，不能据协议擅自替换实例地址和凭据。

应用数据根默认 `~/.vant`，可由 `VANT_HOME` 覆盖。工具配置为 `~/.vant/tools/art-workshop/config.json`；Vant 将工程美术数据绑定至工程 `.vant/art`。共享模型环境默认 `~/.vant/art-env`，控制状态与日志归用户数据根；安装根保存环境标记 `vant.art.config.json`。

## 开发与验证

```sh
npm ci
npm run check
npm run test:package
```

命令返回、结构校验、模拟测试与外部平台实际运行分别核验。发布版本和依赖以随包 `package.json` 为准。

## 文档

[Agent 调用规范](AGENTS.md) · [文档规范](docs/documentation.md) · [art 命令参考](docs/commands.md) · [配置与存储](docs/configuration.md) · [风格核心职责与问题决策](docs/core-guidance.md) · [art 工程与输入结构](docs/data-formats.md) · [本地环境检测与部署](docs/deployment.md) · [模型与执行架构](docs/model-architecture.md) · [模式与调用流程](docs/modes.md) · [远程图片适配与筛选](docs/remote-models.md) · [任务控制与诊断](docs/troubleshooting.md)

## 许可与版权

本工具采用 [MIT 许可](LICENSE)。Copyright © 2026 Vant。Vant 为工具集品牌；Figma、Unity、Steam、微信及其组件归各自权利人所有，第三方组件适用各自许可。
