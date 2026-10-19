# Vant 本地模型部署

## 定位

部署指南由 art 维护；Pi 根据机器环境规划并执行安装，Harness 管理授权、进程、停止与恢复。工具负责环境检测、模型校验和登记。

## 前置条件

配置可用聊天模型，选择项目和本机安装目录、回环服务地址。任务授权覆盖目录内安装、下载及验证采样；已有文件冲突时保留原文件。推荐方案、依赖版本和模型校验值由 environment guide 返回。

## 操作流程

1. `v-cli art environment guide` 读取指南与模型契约。
2. `v-cli art environment list` 发现已有环境；`environment inspect --directory DIR --endpoint URL` 检测指定环境。
3. Pi 使用基础工具与动态工作流完成运行时、节点、依赖、模型和服务配置。网络或命令失败根据实际错误修正，保留成功节点。
4. `environment verify --directory DIR --endpoint URL` 校验文件 SHA256、服务身份和工作流能力；本命令不下载、启动服务或采样。
5. 通过标准计划与任务命令验证生成、编辑；保留原 taskId，不重发未知请求。
6. `environment register --directory DIR --endpoint URL` 重新验收后登记。Vant 部署会话通过 art_operation 调用 environment-register，回填系统目录与地址。

服务需长期运行时使用配置 launch 的 `doctor --start`，由 art 保存归属并在 Vant 退出时清理；普通下载与安装命令使用 Harness 受管进程。

`environment unregister --directory DIR` 仅解除登记，不删除安装文件和模型，也不停止外部服务。

## 结果验证

文件、服务、节点能力与真实采样分别记录。登记的 verification=capabilities 和 sampleVerified=false 表示未以此次登记证明真实出图。模型回复不能替代工具验收。

取消由工作流停止入口处理；普通插话和关闭设置页不终止部署。恢复先核对任务记录、原进程及实际文件，保留有效下载，不重新执行成功节点。未知副作用继续占用，不能当作已停止。

## 参考资料

[部署指南](local-models/qwen-image-2.1.md) · [使用说明](../README.md)
