# art 统一配置

配置是用户级结构化 JSON，远程与本地后端共用一份文件。工具配置只定义执行与资源路径；工程任务和冻结核心保持独立文件，认证由百炼 CLI 管理。

## 位置与覆盖

```powershell
v-cli art config path
v-cli art config init
v-cli art config show
v-cli art config validate
```

config init 创建默认文件，已有文件不覆盖。默认位置：Windows 的 %APPDATA%/art-workshop/config.json；macOS 的 ~/Library/Application Support/art-workshop/config.json；Linux 的 $XDG_CONFIG_HOME/art-workshop/config.json，未设置时使用 ~/.config/art-workshop/config.json。

--config FILE 优先于 ART_WORKSHOP_CONFIG；未指定则使用默认位置。工作流、launch.executable 与 launch.cwd 的相对路径基于配置文件目录。资源目录建议写绝对路径：paths 中相对值实际按当前工作目录解析，不按 config.json 目录解析。

## 一份远程与本地配置

以下是合法结构示例；路径、模型和后端 ID 需与本机安装匹配。

```json
{
  "paths": {
    "workspace": "C:/ArtWorkspace",
    "output": "C:/ArtWorkspace/output",
    "refs": "C:/ArtReferences",
    "cache": "C:/ArtWorkspace/.cache"
  },
  "execution": {},
  "analysisModel": null,
  "defaultProject": null,
  "autoSyncSkills": true,
  "generation": {
    "defaultBackend": "local-qwen",
    "defaults": { "perValue": 1, "promptExtend": false, "watermark": false },
    "backends": {
      "remote-qwen": {
        "provider": "bailian",
        "model": "qwen-image-3.0-pro",
        "execution": { "size": "1024*1024" }
      },
      "local-qwen": {
        "provider": "comfyui",
        "model": "qwen-image-2.1-UC-Q4_K_M.gguf",
        "execution": { "size": "512*512" },
        "endpoints": ["http://127.0.0.1:8188"],
        "workflow": "vant-builtin-qwen-image-2.1-Q4-8GB",
        "options": { "steps": 25, "cfg": 1, "sampler": "euler", "scheduler": "simple", "timeoutSeconds": 1800, "pollMilliseconds": 500 },
        "launch": {
          "executable": "C:/AI/ComfyUI_windows_portable/python_embeded/python.exe",
          "cwd": "C:/AI/ComfyUI_windows_portable",
          "args": ["-s", "ComfyUI/main.py", "--windows-standalone-build", "--disable-dynamic-vram", "--lowvram", "--disable-auto-launch"],
          "startupTimeoutSeconds": 120
        }
      }
    }
  }
}
```

## 顶层字段

| 字段 | 规范 |
|---|---|
| paths.workspace | 工程根目录，包含 projects |
| paths.output | 运行文件夹、图片与 manifest 的根目录 |
| paths.refs | 默认参考目录；--refs-dir 或工程 refsDir 可覆盖 |
| paths.cache | 分析缓存目录 |
| execution | 已有全局执行覆盖；建议新配置保持空，将模式参数放在各后端 |
| generation | 默认后端、共享默认值、后端字典 |
| analysisModel | 覆盖工程分析模型；null 使用工程值，与生图后端独立 |
| defaultProject | 省略 --project 时使用的真实工程 ID，或 null |
| autoSyncSkills | 自动同步随包 skill，默认 true；不影响手动 agent init |

默认资源根为系统下载目录/image.g；cache 默认其 .cache，refs 默认其 refs。Windows 尊重系统下载 Known Folder，Linux 尊重 XDG 下载配置。运行资源须在安装目录之外，禁止通过链接绕回安装目录。

## 执行参数与优先级

最终参数按下列过程形成，后写入者覆盖前值：

1. 通用默认：qwen-image-3.0-pro、1024*1024、perValue=1、promptExtend=false、watermark=false。
2. 工程 project.execution。
3. 所选后端的默认层：内置本地模板先提供 size=512*512，再合并 generation.defaults、backend.execution、backend.model。
4. 顶层 execution。
5. job.execution。
6. 使用 design 时，以每项换算的 outputSize 覆盖 size。

没有显式 --backend 和 generation.defaultBackend 时，不使用 generation.defaults，按已有顶层 execution 路径走百炼默认。冻结计划保留生成时的值，不会随配置变化更新。

| 参数 | 规范 |
|---|---|
| model | 顶层/工程/任务 execution 可指定；backend.model 必填，后端 execution 不接受 model |
| size | 明确 W*H，不能写 1:1；每边 256～4096，本地额外要求 32 的倍数 |
| perValue | 每个选中 item/variant 生成 1～4 张 |
| promptExtend | 布尔值；本地只能 false |
| watermark | 布尔值；本地只能 false |

generation.defaults 和 backend.execution 仅接受 size/perValue/promptExtend/watermark。后端 ID 为配置字典键，不是模型名。--backend 只在编译新计划时选后端。

## ComfyUI 后端字段

| 字段 | 规范 |
|---|---|
| provider | comfyui；远程为 bailian |
| model | 工作流使用的生成模型文件名，与 model binding 对应 |
| endpoints | 非空列表；仅 http、本机 127.0.0.1/localhost/[::1] 根地址；无认证、路径或查询参数 |
| workflow | 省略或内置名称时使用内置模板；其他字符串为 API JSON 文件路径 |
| bindings | 内置模板提供默认绑定；自定义模板必须声明 |
| options | steps 1～10000；cfg 0～100；sampler/scheduler 按实际节点选项；timeoutSeconds 1～86400；pollMilliseconds 50～10000 |
| launch | 可选；没有可用服务且未配置时，任务报错；不自动寻找安装目录 |

launch 使用直接 executable 和 args 数组，不执行 shell 脚本。cwd 为启动工作目录。startupTimeoutSeconds 范围 1～600，默认 120。--start 和正常任务可触发启动；服务保留至 shutdown，没有闲置自动回收。多个 endpoint 按顺序探测；若需启动，则用同一 launch 启动并期待第一个 endpoint 可用，args 中的监听端口应与之匹配。

## 自定义 workflow 与 bindings

从 ComfyUI 导出 API 格式：顶层是节点 ID 字典，节点包含 class_type/inputs。普通画布 JSON 的 nodes/links 不能用于任务；workflow list 中的 UI JSON 用于导入画布，API JSON 用于 art。

以下片段可作为后端条目，放入 generation.backends；指定文件须真实存在。

```json
{
  "provider": "comfyui",
  "model": "qwen-image-2.1-UC-Q4_K_M.gguf",
  "execution": { "size": "512*512" },
  "endpoints": ["http://127.0.0.1:8188"],
  "workflow": "workflows/custom-api.json",
  "bindings": {
    "model": { "node": "1", "input": "unet_name" },
    "prompt": { "node": "4", "input": "prompt" },
    "negativePrompt": { "node": "4", "input": "negative_prompt" },
    "width": { "node": "5", "input": "width" },
    "height": { "node": "5", "input": "height" },
    "count": { "node": "5", "input": "batch_size" },
    "seed": { "node": "6", "input": "seed" }
  }
}
```

| Binding | 调用检查 |
|---|---|
| prompt/width/height/seed | 必需，指向实际已有输入 |
| negativePrompt | 任务负向词非空时必需 |
| count | 执行时写 1；未绑定时模板中 batch_size 必须已为 1 |
| model | 写入最终 execution.model；未绑定时 GGUF 固定模型须与执行模型一致 |
| image | 本地图编辑必需，指向 LoadImage.image |
| vae | 本地图编辑必需，指向 VAELoader.vae_name；用于建立编码器 VAE 连接 |

节点 ID 和 input 名是执行映射，中文 title 只用于展示。options 的采样参数写入 seed 所在节点，因此需要对应输入。每次请求复制模板，动态填提示词、尺寸、seed；不修改原模板。perValue 次请求串行执行，seed 依次为初始 seed+index，要求每次恰好输出一张最终图片。

Qwen 2.1 编辑模板额外加入 LoadImage，并声明 image/vae bindings；编辑时适配器连接 TextEncodeQwenImage21 的 images.image_1 与 vae。模板编码器 resolution=1024 是参考编码参数，不是输出宽高；EmptyLatentImage 的动态 size 决定采样画布。

## 路径与持久化检查

| 对象 | 相对路径基准 |
|---|---|
| --input/--report/--plan/--out/--review、edit source | workspace |
| check/select RUN | output |
| 分析 refs[].path | 命令实际参考目录 |
| project.refsDir | workspace |
| workflow、launch.executable、launch.cwd | config.json 的目录 |
| paths 字段、CLI 目录覆盖 | 当前工作目录；建议使用绝对路径 |

--workspace、--output-dir、--refs-dir、--cache-dir 临时覆盖目录。参考目录顺序为显式 --refs-dir、工程 refsDir、用户 paths.refs。任务状态、锁和服务日志存于 config.json 旁 .runtime/<配置路径哈希>；该目录不是 workspace 的分析缓存。

config validate 不执行节点、不探测 HTTP，也不检查全部工程文件。doctor 检查环境；plan 校验具体任务和参数；run --dry 校对具体请求；真实运行验证模型可执行性。通过某一层不能省略后续层的模式要求。
