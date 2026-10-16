# Vant 配置与存储

## 定位

配置与存储，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 字段与示例

### 配置入口

`config path/show/init/validate` 分别查询位置、生效配置、创建模板和校验。`config init` 不覆盖已有文件。查询、发现和预演不创建参考目录；`config validate` 不联网、不启动服务。

配置位置优先级为 CLI `--config`、`ART_WORKSHOP_CONFIG`、`<VANT_HOME 或 ~/.vant>/tools/art-workshop/config.json`。资源路径优先级为 CLI 路径选项、配置 paths、默认路径。配置文件和资源均须位于工具安装目录之外。

| 字段 | 职责与默认值 |
| --- | --- |
| paths.workspace | 默认 ~/.vant/tools/art-workshop/workspace，保存 projects 和 .runtime |
| paths.output | 默认与 workspace 相同；执行批次与候选产物根 |
| paths.refs | 默认 workspace/refs，素材导入基准；不是对象的权威参考目录 |
| paths.cache | 默认 workspace/.cache，分析等缓存 |
| execution | 全局执行默认值，具体范围由所选模型策略校验 |
| generation | defaultBackend、defaults、backends |
| analysisModel | 分析模型默认值，连接仍需单独就绪 |
| defaultProject | 未传 --project 时的工程 ID，不跨工程回退 |
| autoSyncSkills | 默认 true；实际分析、采用、运行入口可刷新随包技能，查询与 dry 不刷新 |

Vant 显式传入绑定，把工程对象、参考、批次及图片集中在工程 `.vant/art`。独立 CLI 默认 workspace 可以容纳多个工程，不自动绑定当前 Git 工程。普通输入、计划和报告相对路径以 workspace 为基准；`check RUN` 相对批次以 output 为基准。参考源文件建议提供绝对路径。

### 后端配置

远程 provider 为后端类别标识；执行协议来自 credentialReference.api，缺省 DashScope。协议必须已注册，型号必须在该协议目录中精确登记且支持所需模式。provider 名称不是权限或协议兼容性的证明。

下面仅示例结构，不含凭据。具体参数以 [适配目录](remote-models.md) 和生成预演为准。

```json
{
  "generation": {
    "defaultBackend": "remote-image",
    "backends": {
      "remote-image": {
        "provider": "bailian",
        "model": "qwen-image-2.0-pro",
        "execution": { "size": "1024*1024", "perValue": 1, "watermark": false }
      }
    }
  }
}
```

ComfyUI 后端使用 provider=comfyui，声明 model、endpoints，以及可选 workflow、bindings、options、launch。省略 workflow 使用随包固定方案；自定义工作流必须是 API JSON，bindings 指向真实节点输入。endpoints 只允许本机 HTTP 根地址。launch 明确 executable/cwd/args；工具以 argv 启动，不拼接 shell。详情见 [本地部署](deployment.md)。

### 认证与实例

Vant 系统模型配置统一保存 Provider 实例及凭据，工程只引用实例身份、修订及不含密钥的连接信息。模板只负责预填新实例，不是可执行连接。模型目录发现、能力登记、启用与账号权限是不同事实。

远程图片由组织层通过 ART_IMAGE_CONNECTION（api/baseUrl）和 ART_IMAGE_KEY 注入内存；明确连接缺少密钥时拒绝，不能回退另一份密钥或站点。直接调用 DashScope 使用固定版本百炼核心库的既有认证来源。

视觉分析独立使用 ART_VISION_CONFIG 与 ART_VISION_KEY，支持 openai-completions、openai-responses、anthropic-messages、google-generative-ai。未注入连接时分析走百炼 CLI。不要把图片输出模型当作视觉分析模型；分析要求图片输入和文字输出。

凭据不进入工程、计划、运行回执、日志或命令行。Token Plan 与按量渠道保留各自实例地址和密钥，不跨渠道回退。配置校验不证明凭据有效、模型授权或实际出图。

### 状态与共享环境

对象变更锁和执行登记归 workspace/.runtime；更换配置文件不产生另一套占用。共享服务登记归用户数据根的 state/art-services，环境索引、接入日志和证据归 state/art-environments。安装根保存模型、程序与 vant.art.config.json，控制数据写入用户 .vant 数据目录。



## 执行边界

字段、路径与权限以当前 schema、运行时校验和明确授权为准；配置有效不等于外部服务已执行成功。

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
