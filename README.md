# Vant 美术工坊

`@kevlns/art-workshop`

## 功能

同一个工具包提供两个独立二级通道：`image` 管理项目风格、参考图、图片生成、编辑与定版；`video` 管理剧本、镜头、视频生成、成片合成与精修。图片支持本地 ComfyUI 与远程图片模型，视频使用已配置的本机 ComfyUI 和 FFmpeg。

## 环境要求

图片通道需要 Node.js 20.9 及以上；视频通道需要 Node.js 22.13 及以上及 SQLite 支持。本地生成还需工具检测通过的 Python、显卡驱动与 ComfyUI 环境；视频合成和取帧需要 FFmpeg / ffprobe。

## 安装

```sh
npm install -g @kevlns/art-workshop
```

## 快速开始

```sh
art-workshop image config show
art-workshop image config validate
art-workshop image agent index
```

## 使用说明

### 使用流程

图片命令以 `art-workshop image` 或 `v-cli art image` 开头；原有不带 `image` 的图片命令继续兼容。视频以 `art-workshop video` 或 `v-cli art video` 开头，`--workspace` 明确指定工程根目录，不复用图片对象工作区。两条通道的模型配置、任务身份和状态分别保存。完整调用、SDK 和失败模式见 [图片与视频通道](docs/channels.md)。

1. 创建 schemaVersion 2 工程和风格，按关注点导入分析参考；讨论后保存描述、约束和绘制规则，通过 `style confirm` 确定性编译当前风格。修改内容后需要重新确认。
2. 用 `style sample-job` 创建仅文字打样任务，`--input` 可提交自定义主体、验证目标、尺寸和生成方案，`--count` 指定每个主体生成 1～4 张候选，配置模型、编译预案并按任务授权生成。用户认可候选后用 `style sample-select` 完成样张定版并加入当前风格的运行时参考；不合适时修改配置并重新确认，再准备新样张。
3. 用 `job template` 创建实际任务，填写需求，选择 `styleReferenceMode` 为 `approved`（运行时参考）或 `text-only`（仅规则）。动态参考先 `job analyze`；编辑底图单独绑定。
4. 编译 `generate plan` 或 `edit plan`，保存并用 `run --plan ... --dry` 核对模型、尺寸、候选数、样张输入和参数转换，再按任务授权执行。
5. 保存执行 taskId；前台和后台都登记运行。查询原身份，不因超时或重启重复提交。`check` 核验产物，`candidate finalize` 定版；替换需 `--replace`，删除需 `--confirm`，均保留事实记录。

风格按当前 revision 保存，不要求派生或重新采用；历史核心快照和批次保留，规则或样张变化后重新编译预案。原始分主题参考用于分析，不自动整图上传。运行时参考与规则哈希绑定，过期样张不作为当前规则的视觉依据；后端不支持图片输入时明确报错，可选择仅规则模式。任务空闲后可按原身份更新配置。job discard 归档任务，job restore 按当前版本恢复；配置、收藏与历史图片保留。任务列表默认按执行中、待定版、草稿、已定版排序；运行状态与停止证据分别判断，不能只看终态释放占用。

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

[Agent 调用规范](skills/art-workshop/SKILL.md) · [文档规范](docs/documentation.md) · [art 命令参考](docs/commands.md) · [配置与存储](docs/configuration.md) · [风格核心职责与问题决策](docs/core-guidance.md) · [art 工程与输入结构](docs/data-formats.md) · [本地环境检测与部署](docs/deployment.md) · [模型与执行架构](docs/model-architecture.md) · [模式与调用流程](docs/modes.md) · [远程图片适配与筛选](docs/remote-models.md) · [任务控制与诊断](docs/troubleshooting.md)

## 许可与版权

本工具采用 [MIT 许可](LICENSE)。Copyright © 2026 Vant。Vant 为工具集品牌；Figma、Unity、Steam、微信及其组件归各自权利人所有，第三方组件适用各自许可。
