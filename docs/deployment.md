# Vant 本地环境检测与部署

## 定位

本地环境检测与部署，适用于当前随包实现。

## 前置条件

先按包的环境要求准备工程与工具，使用实际配置和命令帮助核对目标。

## 操作流程

固定自动安装方案由 lib/deployment.mjs 的 LOCAL_RECIPE 维护：ComfyUI、GGUF 节点、Python/Torch 依赖以及三个模型的准确版本和 SHA256。自动部署当前只适配 Windows NVIDIA 环境；已有便携 Python 可复用，新建 venv 需要可用的 Python >=3.12。

### 目录与端口

Vant 检测窗口默认安装目录为 `<VANT_HOME 或 ~/.vant>/art-env`，允许选择其他目录及本机可用端口。已有便携安装应选择包含 ComfyUI 和 python_embeded 的根目录，而不是 models、ComfyUI 子目录或旧 .vant-art。

空目录输入时，组织层可用 discoverInstallations 读取环境索引，并在默认目录、用户 AI 目录及 Windows C:/AI、D:/AI、E:/AI 有界扫描环境标记和 ComfyUI。扫描有深度和数量预算，不是全盘检索。独立 CLI deployment plan 必须明确 --directory，不会自行执行界面的自动选择逻辑。

端口自动选择只证明检测时可绑定，不预约端口。目录或端口变更后重新检测，确认的地址随环境保存；实际启动仍可能因端口被其他程序占用而失败。不能把其他进程监听同一端口视为此目录的环境。

### 已有环境复用

1. 检查 Python、ComfyUI、GGUF 节点、固定模型文件及大小，检查生成与编辑工作流的实际节点能力和端口归属。
2. 对可复用但未登记环境，adoptInstallation 流式验证模型 SHA256，连接或启动对应服务，核验能力后写入标记及用户环境索引。保留原模型；不因未登记而再次下载整套环境。
3. 接入检测的 verification=capabilities 只代表环境和工作流能力验证。新部署产生的真实生成、编辑验证图是另一等级证据，不能混称。
4. 缺文件或版本不符时展示具体差异。固定部署不自动覆写不匹配源码、模型或用户安装；先明确处理差异，再生成新预案。

### 独立 CLI 流程

以下示例使用已核对的安装目录与端口；启动前必须有部署、下载及验证采样的任务授权。

```sh
v-cli art deployment plan --directory C:/AI/ComfyUI_windows_portable --endpoint http://127.0.0.1:8188/ --out deployment.json
v-cli art deployment start --plan deployment.json --operation local-deploy-001
v-cli art deployment status --id DEPLOYMENT
v-cli art deployment cancel --id DEPLOYMENT
v-cli art deployment recover --operation local-deploy-001
```

plan 检测 Git、GPU、Python、文件与磁盘；需要下载模型时同时检测 curl.exe。不下载、不启动服务、不采样；现有文件存在不等于哈希已验证。Git 需能在 Vant 的 PATH 中直接执行，安装 Git for Windows 或修改 PATH 后须完全退出并重新启动 Vant。start 和工作进程执行前再次复核依赖与冻结预案；源码克隆前创建临时工作目录，完成固定提交检出后才提交源码。缺少命令与工作目录不可用分别报告，不再统一显示 ENOENT。

start 创建后台 deploymentId，逐阶段记录实际进度，按固定方案安装、校验、生成与编辑采样；完成后才提交配置。下载或校验失败不覆写既有冲突文件。

status 查询原部署。cancel 只停止已核验的本部署进程与采样，不删除用户素材或原模型，不关闭用户先前启动的服务。recover 只找回唯一原登记，不重复安装。工作进程丢失或停止未确认时保留 unknown 与安装占用。

### 存储与关闭

安装根保存程序、模型和 vant.art.config.json；环境索引、受管服务身份、日志和验证证据归 ~/.vant/state。项目生图归工程绑定的 .vant/art，不能写入共享模型环境。

Vant 退出使用其应用生命周期清理关联后台任务，并关闭可核验为 Vant 启动的 ComfyUI，确认本机端口释放。单独关闭部署窗口不取消部署。CLI shutdown 的工作区与共享服务边界见 [任务控制](troubleshooting.md)。

## 结果验证

结合原始错误、结构化结果和实际产物核验；测试与真实平台执行分别记录。

## 参考资料

[使用说明](../README.md)
