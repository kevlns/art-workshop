# 美术工坊

三个独立模块：风格分析与核心冻结、文生图、图编辑。默认模型 qwen-image-3.0-pro，尺寸 1024*1024，关闭 prompt 扩写。

## 随包 skill 与能力发现

skills/art-workshop 是精简的使用指导，随 npm 包一起分发，支持隐式发现。安装或更新包时，以及正常分析、冻结、生成或编辑调用时，自动同步到当前目录及用户目录下已有的 Agent 技能目录（含 .codex/skills、.agents/skills、.claude/skills 等；也支持 CODEX_HOME/skills）。不存在的技能目录不创建。只读查询、plan 与 --dry 不自动同步。

```powershell
node art-workshop.mjs agent index
node art-workshop.mjs agent docs
node art-workshop.mjs agent init --directory C:/MyProject --dry
node art-workshop.mjs agent init --directory C:/MyProject
npm run skill:sync
```

index 输出工程、核心、任务及模块入口，docs 输出随包完整指导。init 只同步技能，不写 AGENTS.md。随包文件是权威来源，同名文件更新，其他扩展文件保留；同步结果列出 current/updated/would-update。runtime.json 记录实际工具入口，已发现的 skill 无须猜测安装位置。Agent 通常在下次加载技能列表或新会话时发现它。安装：`npm install -g @kevlns/art-workshop`；本地配置与工程冻结核心均位于工具目录之外，不随 npm 包发布。

## 本地配置与外部路径

本地配置默认位于 Windows 的 %APPDATA%/art-workshop/config.json、macOS 的 ~/Library/Application Support/art-workshop/config.json、Linux 的 $XDG_CONFIG_HOME/art-workshop/config.json（未设置时使用 ~/.config）。它在用户目录，不进入工具 Git 仓库或 npm 包。

`config path` 查看位置，`config show` 查看生效配置，`config init` 创建默认文件，不覆盖已有文件。通过 `--config FILE` 或 ART_WORKSHOP_CONFIG 可指定其他外部配置文件。

配置结构：

```json
{
  "paths": {
    "workspace": "C:/Users/你的用户名/Downloads/image.g",
    "output": "C:/Users/你的用户名/Downloads/image.g",
    "refs": "D:/ArtReferences",
    "cache": "C:/Users/你的用户名/Downloads/image.g/.cache"
  },
  "execution": {},
  "analysisModel": null,
  "defaultProject": null,
  "autoSyncSkills": true
}
```

paths 的四个目录均可独立修改；默认采用系统下载目录/image.g，Windows 会读取实际下载 Known Folder，Linux 尊重 XDG 下载目录。workspace 存放 projects；output 存放每次运行的独立文件夹与 manifest；refs 为默认参考图目录；cache 为分析缓存。所有运行资源路径必须在工具目录之外，包括编辑原图、报告与计划。

execution 可配置 model、size、promptExtend、perValue、watermark。尺寸使用明确像素，如 1024*1024。生图参数优先级为内置默认 → 工程配置 → 本地 execution → 任务 execution；已有冻结计划保留预演时的实际参数，需重新 plan 才能采用新默认值。analysisModel 覆盖工程的分析模型；defaultProject 可省略常用 --project；autoSyncSkills 控制自动同步，手动 agent init 始终可用。

命令行 --workspace、--output-dir、--refs-dir、--cache-dir 临时覆盖对应路径。参考图的相对 path 以参考图目录解析，绝对 path 直接使用；参考目录优先级为 --refs-dir → 工程 refsDir → 本地配置。其他相对资源文件路径以 workspace 解析；check/select 的相对运行目录以 output 解析。

每次 CLI 配置生效时，自动检查并补齐 refs 下的 style、palette、subject、composition、material、text、pose 分类目录；选定工程有独立 refsDir 时也会检查该目录。包括只读查询和 --dry，只创建缺少的目录，不移动或覆盖素材；目录位置被文件占用时明确报错。配置解析本身无文件写入，CLI 应用配置时完成目录初始化。

`refs guide` 解释各目录作用、推荐图片样式与可用分析 scope，并显示实际参考目录；可加 `--project P` 查看工程目录，或 `--refs-dir DIR` 临时指定。目录仅用于整理，不自动识别角色或绑定图片。分析仍在输入 refs 中显式声明 path、scope 和 note。构图、文字、姿态的具体要求属于单体计划，不自动冻结进核心。

```powershell
node art-workshop.mjs config show
node art-workshop.mjs refs guide --project cellgame
node art-workshop.mjs style analyze --project cellgame --input projects/cellgame/briefs/style.json --refs-dir D:/ArtReferences --dry
node art-workshop.mjs generate run --plan .cache/plans/white-cell.json --dry
```

## 工程结构

顶层指导规则：rules/core-guidance.json。工程配置位于 projects/<project>/project.json；briefs 保存分析输入，reports 保存报告，cores 保存冻结核心，profiles 保存资产规格，jobs 保存真实需求。这些目录位于外部工作目录，不属于工具安装目录。输出默认位于系统下载目录的 image.g，参考图与缓存也使用外部路径。

所有模块明确指定工程；核心不跨工程回退。新工程须创建自己的 project.json，并通过该工程的报告冻结核心，不能复制冻结文件并修改身份。工程 cores 可列多份核心，defaultCore 为明确默认或 null。

## 风格分析与冻结

输入包含 project、id、description、refs、constraints。图片参考声明 path、scope（style/palette/shape/render）、note。纯语言也可分析；多图分别观察后合并。参考图只用于分析，文生图不会自动把这些图片传给生图模型。

```powershell
node art-workshop.mjs style analyze --project cellgame --input projects/cellgame/briefs/style.json --dry
node art-workshop.mjs style analyze --project cellgame --input projects/cellgame/briefs/style.json --out projects/cellgame/reports/new-style.json
node art-workshop.mjs style validate --project cellgame --report projects/cellgame/reports/new-style.json
node art-workshop.mjs style freeze --project cellgame --report projects/cellgame/reports/new-style.json
node art-workshop.mjs style show --project cellgame --core new-style
```

分析只生成报告，不自动冻结。报告区分观察证据、置信度、推荐配置、conflicts 与 uncertainties。处理完冲突和未确定项才能冻结。freeze 表示采用推荐配置；已有核心不能覆写，另一套风格使用新的核心 ID。

核心只拥有媒介、形体、渲染、光照、色彩关系与题材适配。正向和负向风格提示词从同一结构化核心生成。结构校验覆盖已定义的矛盾；自然语言证据与完整语义仍需审阅。规则详见 docs/core-guidance.md。

## 文生图

任务 kind 为 generate，core 绑定风格，profile 绑定资产规格。items 声明 intent、entities、effects、relations、composition、mustRead、seed 与 variants。候选只调整构图和 seed。

核心选择顺序：显式 --core → 任务 core → 工程 defaultCore。显式指定与任务绑定冲突时报错，须先修改任务绑定。没有明确选择时不能猜测。计划保存核心身份、哈希、选择依据与完整快照。

```powershell
node art-workshop.mjs generate show --project cellgame --job skills
node art-workshop.mjs generate plan --project cellgame --job skills --out .cache/skills-plan.json
node art-workshop.mjs generate run --plan .cache/skills-plan.json --item skill-01 --dry
node art-workshop.mjs generate run --plan .cache/skills-plan.json --limit 2
node art-workshop.mjs generate run --plan .cache/skills-plan.json --item skill-01 --variant front --dry
```

plan 编译全部候选；run 默认 base，--variant 选指定候选，--explore 执行全部候选。修改任务后重新 plan，冻结计划不能同时修改来源配置。

背景默认 {type:solid,color:#FFFFFF}，纯黑用 #000000。其他纯色可显式配置，渐变用 gradient/from/to，场景用 scene/description 且须被资产规格允许。背景提示词和验收共用解析结果。

## 图编辑

任务 kind 为 edit，每项有 source、changes、preserve、mustRead、可选 seed。范围为 background/style/shape/color/composition/content/detail/text；同一范围不能同时修改和保留。背景修改用结构化 value，其他范围用 instruction。

```powershell
node art-workshop.mjs edit show --project cellgame --job edit-white-background
node art-workshop.mjs edit plan --project cellgame --job edit-white-background --out .cache/edit-plan.json
node art-workshop.mjs edit run --plan .cache/edit-plan.json --dry
node art-workshop.mjs edit run --plan .cache/edit-plan.json
```

编辑默认保留原图风格，不自动读取工程默认核心或替换背景。目标风格须明确绑定 core，此时不能再写 style 修改或保留。原图哈希写入计划，原图改变后须重新预演。示例任务将已有 skill-01 改成纯白背景，保留主体、效果和构图。

## 预演与验收

plan 与 run --dry 均不调用远程生图，分别返回完整编译快照与选定项实际请求参数，不生成图片。分析 --dry 返回预计请求，实际远程调用数为 0。

实际 run 保存图片、输入和输出哈希、失败记录。人工分别检查 content/style/asset，产物完整、生成成功且三个维度全部 pass 才能 select。check 汇总人工验收，不自动评价图像。

```powershell
node art-workshop.mjs check <runId> --out .cache/review.json
# 编辑 review 的 content/style/asset 为 pass/fail/pending，并填写 reason。
node art-workshop.mjs check <runId> --review .cache/review.json
node art-workshop.mjs select <runId> --item skill-01 --variant base --review .cache/review.json
node art-workshop.mjs compare .cache/plan-a.json .cache/plan-b.json
node --test tests/art-workshop.test.mjs
```

依赖 Node.js 与已配置的 bailian-cli。历史图片保留供对照，旧配置和旧计划接口不再支持。真实模型效果需另行实测。

## v-cli 接入

美术工坊是 v-cli 的随包官方插件，入口为 `v-cli art`。先运行 `v-cli agent docs art` 和 `v-cli agent describe art --json`，再运行 `v-cli art config show`、`v-cli art agent index` 选择正确工程。本文所有 `art-workshop` 命令都可将前缀替换为 `v-cli art`；参数、外部本地配置和冻结核心保持一致。`v-cli art --help` 查看入口，`v-cli art agent docs` 查看完整使用规范。
