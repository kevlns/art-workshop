---
name: art-workshop
description: 使用 美术工坊 分析并冻结视觉风格、在多工程中按核心配置生成统一风格图片，或按修改与保留计划编辑现有图片。任务提到 美术工坊、核心冻结、风格报告、统一风格批量生图或本工具的图片编辑时使用。
---

# 美术工坊

已安装 v-cli 时可用 `v-cli art` 调用全部命令，首次先读取 `v-cli agent docs art`，用 `v-cli agent describe art --json` 发现完整参数。独立调用时读取同目录 `runtime.json`，通过 `node <entry>` 调用工具；已安装全局命令时可用 `art-workshop`。随包直接使用时，在工具目录执行 `node art-workshop.mjs`。下文用 `art-workshop` 表示该入口。

先用 `art-workshop config show` 读取本地配置与外部工作目录，再用 `art-workshop agent index` 发现模块、工程及核心；需要完整用法或配置结构时读取 `art-workshop agent docs`。查看实际任务用 `<generate|edit> show --project <工程> --job <任务>`，不要猜测任务或核心身份。

用 `art-workshop refs guide [--project P] [--refs-dir DIR]` 查看实际参考目录、分类用途与推荐图片。每次 CLI 配置生效都会补齐缺少的参考分类目录，包括 --dry；不覆盖素材。分类不自动绑定图片，分析仍显式声明 path、scope、note，构图、文字和姿态的具体要求放入单体计划。

- **风格分析与冻结**：`style analyze --project P --input FILE --out REPORT` 生成证据、推荐配置、冲突与未确定项；`style validate --project P --report REPORT` 校验；用户采用该报告后用 `style freeze --project P --report REPORT`。分析不会自动冻结，已有冻结核心不能覆写。
- **文生图**：`generate plan --project P --job J --out PLAN`，再 `generate run --plan PLAN --item ID --dry` 查看真实请求，实际生成去掉 `--dry`。run 默认 base，`--variant ID` 选择候选，`--explore` 执行全部候选，`--limit N` 限制单体数。
- **图编辑**：`edit plan --project P --job J --out PLAN`，再 `edit run --plan PLAN [--dry]`。任务必须明确原图、修改范围与保留范围；原图发生变化后重新预演。

核心只定义可复用的视觉语言；主体、数量、颜色、动作归需求；背景和构图许可归资产配置；模型与尺寸归执行。语言精炼、用词准确、前后一致，各模块职责清楚。核心选择依次为显式 `--core`、任务绑定、工程默认；显式选择与任务绑定冲突时先修改任务，不跨工程回退。

文生图默认纯白背景；纯黑、其他纯色、渐变或场景须明确声明。编辑保留原图未要求修改的部分，不自动换背景或套工程默认核心。编辑绑定核心时，风格由核心负责，不能又声明保留原图风格。

plan 和 `--dry` 不产生图片、没有远程生图调用；真实分析或 run 会调用模型，按用户已授权范围执行，不因预演请求擅自开始付费调用。修改需求后重新编译计划，不手改冻结计划。

生成后用 `check RUN --out REVIEW` 导出人工验收，分别审查 content/style/asset，再用 `check RUN --review REVIEW` 汇总；只有三项全部 pass 才能 `select RUN --item ID --variant ID --review REVIEW`。check 不自动评价图片。

随包 skill 是权威来源，`agent init --directory DIR` 同步到 DIR 下已有的 Agent 技能目录；保留项目扩展文件。修改随包源后重新同步，不直接改已同步的 SKILL.md。

资源路径：工程、报告、计划、参考图、缓存、编辑原图与输出均放在工具目录之外。默认输出为系统下载目录/image.g。参考目录可用 --refs-dir 指定；其他路径用 --workspace、--output-dir、--cache-dir 覆盖。相对资源文件按 workspace 解析，参考图按 refs 目录解析；不要在安装目录创建工程或产物。本地配置位于用户配置目录，通过 config path/show/init 发现；不纳入 Git。
