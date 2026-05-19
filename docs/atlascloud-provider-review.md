# Atlas Cloud Provider Review

## 变更范围

- 新增 `serviceGenerators/AI/atlascloud`，作为独立 Atlas Cloud provider。
- 复用现有 OpenAI-compatible `proxy` 请求链路，默认接到 `https://api.atlascloud.ai/v1/chat/completions`。
- 新增 `ATLASCLOUD_API_KEY` 环境变量示例，供本地和部署配置。
- 在主 README 中补充 Atlas Cloud provider 说明和官方链接。

## 默认配置

- Provider 名称：`Atlas Cloud`
- 默认模型：`deepseek-ai/DeepSeek-V3-0324`
- 默认接口：`https://api.atlascloud.ai/v1/chat/completions`
- API Key 来源：`ATLASCLOUD_API_KEY`
- 流式输出：默认开启

## 本地验证计划

- 真实调用 Atlas Cloud 的非流式 `Call`
- 真实调用带 `replyPreviewUpdater` 的流式 `StructCall`
- 启动 fount 做一轮启动冒烟验证
- 确认未把本地测试 key 提交到仓库
