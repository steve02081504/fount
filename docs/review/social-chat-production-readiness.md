# fount Social / Chat 健壮性与成熟度评估报告

生成时间：`2026-07-04`

> **后续注记（2026-07-08）**：本报告的"必须补"清单已编入 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)（工作流 C / E，排期 M5 / M6；实施进度以代码为准，文档不追踪）。另补一条本报告未覆盖的健壮性缺口：world 目前是单主机托管，主机离线即全群 world 钩子瘫痪——去中心化方案见 [world-distribution-spec.md](../design/world-distribution-spec.md)（工作流 G）。

## 摘要

结论先行：`fount` 当前的 `chat` / `social` 已经明显超出玩具项目，底层协议、联邦同步、冷热分层存储、权限/加密、测试意识都比常见 hobby 社交项目扎实得多；但如果标准是 `QQ` / `Discord` / `Mastodon` / `Twitter` 这类“生产级成品”，当前仍然**不属于同一成熟度层级**。

它更接近：

- `chat`：强联邦/副本/加密/归档内核，产品闭环尚未完成
- `social`：高完成度联邦社交原型，平台化与运营化能力不足

一句话概括：**强内核，弱产品；强架构，弱平台；可以认真继续做，但还不能称为生产级聊天/社交软件。**

## 评分总览

> 评分是相对“主流生产级产品”而不是相对 hobby 项目。

| 维度 | Chat | Social | 说明 |
| --- | --- | --- | --- |
| 核心功能完整度 | 7.5/10 | 7/10 | 基础功能已成型，不再是空壳 |
| 协议/数据层设计 | 8.5/10 | 8/10 | 联邦、签名、归档、复制、权限模型很认真 |
| 健壮性/边界校验 | 8/10 | 7.5/10 | 非信任边界处理明显有意识 |
| 产品完成度 | 5/10 | 5/10 | 搜索、通知、未读、运营能力明显不足 |
| 运维/可观测性 | 4.5/10 | 4.5/10 | 有 Sentry，但离完整生产可观测体系较远 |
| 大规模可扩展性 | 4.5/10 | 4.5/10 | 多处仍依赖 JSONL 扫描/本地物化拼装 |
| 生态互通能力 | 4/10 | 3/10 | social 不是 ActivityPub；外部生态兼容弱 |
| 综合成熟度 | 6/10 | 5.5/10 | 高质量原型 / 早期系统，不是成熟产品 |

## 一、目前已经具备的东西

### 1. Chat 已具备的强项

- 有完整的群/频道/线程/角色权限治理，不只是单纯发消息。
- 联邦同步链路较完整，存在 `join snapshot -> gossip 补洞 -> archive month sync` 的分层恢复路径。
- 有冷热分层存储：热区快照、消息 cache、DAG WAL、冷归档月文件。
- 有频道级内容加密与文件主密钥轮换，私密消息不是 UI 级遮罩。
- 有附件/分块/联邦复制/媒体懒加载。
- 有 WebSocket、presence、音视频 relay / streaming channel。
- 有管理员治理能力，如 kick / ban / owner 交接 / audit。
- 测试矩阵明显比普通原型完整。

### 2. Social 已具备的强项

- 有完整基础互动：发帖、删帖、回复、点赞、转发、引用、收藏、媒体、profile。
- 有关注/拉黑/隐藏等基础关系模型。
- 有 followers-only 帖文与加密可见性控制。
- 有联邦时间线 pull / fanout / discover RPC / mention 通知链路。
- 有发现、搜索、趋势、通知、前端视图与前后端闭环。
- 直接复用 P2P identity / reputation / personal list / vault 基础设施。

## 二、为什么现在还不能叫生产级

### 1. 搜索能力仍然是原型级

`chat` 搜索目前本质上是前端对当前已加载消息做过滤，不是全文索引、历史检索、跨频道检索：

- `src/public/parts/shells/chat/public/hub/wireHeaderEvents.mjs`
- `src/public/parts/shells/chat/public/hub/messages/channelMessageStore.mjs`

`social` 搜索也是在观看者“已知时间线（关注 + 自身）”中扫描可见帖子：

- `src/public/parts/shells/social/src/search.mjs`

这和 `QQ` / `Discord` / `Mastodon` / `Twitter` 的可扩展搜索系统不是一个量级。

### 2. 未读、通知、已读状态闭环明显不足

`chat` 目前可见的是浏览器后台页 `Notification` 弹窗，而不是可靠推送体系：

- `src/public/parts/shells/chat/public/hub/hubNotifications.mjs`

`social` 的通知是后端现算、前端用 `localStorage` 记录已读水位：

- `src/public/parts/shells/social/src/notifications.mjs`
- `src/public/parts/shells/social/public/src/views/notifications.mjs`

这说明当前缺少：

- 服务端持久通知 inbox
- 多端同步的已读/未读状态
- push / web push / 移动推送
- mention / unread / badge 的完整产品模型

### 3. 审核、治理、运营能力远未到平台级

`social` 的公开事件类型仍主要集中在帖子和基础互动：

- `src/decl/socialAPI.ts`

当前明显缺少或未形成体系的能力包括：

- 举报 / 审核队列
- 内容警告 / 敏感媒体 / NSFW 流程
- 静音 / 列表 / 申诉 / 封禁产品面
- 风控后台 / 运营工具 / 可审计治理流程

这正是 `Mastodon` / `Twitter` 真正难、也真正决定能否线上运营的部分。

### 4. social 不是 ActivityPub 生态的一部分

`social` 当前使用的是自定义 P2P / Trystero 联邦，而不是 ActivityPub：

- `src/public/parts/shells/social/public/llms.txt`

这意味着它不是 “Mastodon-compatible implementation”，而是自研联邦社交协议。  
优点是架构自由度高，缺点是现成生态、客户端、互通网络几乎拿不到。

### 5. 大规模扩展能力还不够像成熟平台

从现有实现能看到多个偏“本地扫描 / 物化聚合 / JSONL 读写”的路径：

- `src/public/parts/shells/social/src/search.mjs`
- `src/public/parts/shells/social/src/trending/hashtags.mjs`
- `src/public/parts/shells/social/src/notifications.mjs`
- `src/public/parts/shells/chat/src/chat/lib/userGroups.mjs`

这类实现对单机、小圈子、低中规模是够用的，但离海量历史数据、复杂索引和高并发读路径仍然有明显距离。

### 6. 可观测性和运维成熟度不足

仓库中能看到 `Sentry` 接入，说明已经具备基础错误上报意识：

- `src/server/index.mjs`
- `src/server/web_server/index.mjs`
- `src/server/sentry_state.mjs`

但目前没有看到足够明确的生产级指标/链路追踪体系，例如：

- Prometheus 指标
- OpenTelemetry tracing
- 统一容量/延迟/SLA 监控
- 系统化回压/重试/降级/恢复策略展示层

所以当前更像“知道哪里报错”，不像“能稳定运营大规模实时社交系统”。

## 三、与主流产品的差距

### 1. 对比 QQ

差距主要在：

- 多端状态同步
- 已读/未读/回执/提醒闭环
- 后台推送与移动端体验
- 音视频与弱网体验成熟度
- 风控、客服、运营体系

`fount chat` 更像“有想法且内核扎实的联邦 IM 引擎”，不是“全民级日用通讯软件”。

### 2. 对比 Discord

差距主要在：

- 语音/视频/屏幕共享产品化程度
- 机器人生态与开放平台
- 社区治理工具、审核面板、权限运营细节
- 海量在线实时基础设施成熟度

但要强调：`fount chat` 在联邦、冷热归档、本地副本自治这条线上，反而比普通中心化聊天工具更有自己的技术特色。

### 3. 对比 Mastodon

差距主要在：

- ActivityPub 互通生态
- 实例治理与审核经验
- 公开社交产品细节
- 客户端/工具/第三方生态

`fount social` 和 `Mastodon` 的关系更像“不同路线”，不是“完成度略低的同类实现”。

### 4. 对比 Twitter

差距主要在：

- 搜索
- 趋势
- 推荐
- 通知
- 风控
- 分发规模
- 运营与实验基础设施

`fount social` 当前更像“联邦时间线系统”，不是“成熟的大规模公共内容平台”。

## 四、最关键的正面证据

### Chat

1. 联邦同步链路存在分层恢复与补洞逻辑：  
   `src/public/parts/shells/chat/src/chat/federation/index.mjs`

2. 冷热存储结构和读取路径明确：  
   `src/public/parts/shells/chat/public/hub/AGENTS.md`  
   `src/public/parts/shells/chat/src/chat/lib/paths.mjs`  
   `src/public/parts/shells/chat/src/chat/dag/queries.mjs`

3. 频道消息加密与解密失败占位是实装的：  
   `src/public/parts/shells/chat/src/chat/channel_keys/content.mjs`

4. 文件主密钥轮换与群治理联动：  
   `src/public/parts/shells/chat/src/group/routes/governance.mjs`

5. 测试矩阵丰富，覆盖联邦、归档、mailbox、AV、前端：  
   `src/public/parts/shells/chat/test/manifest.json`

### Social

1. followers-only 帖是真正的内容可见性控制，不是简单字段标记：  
   `src/public/parts/shells/social/src/endpoints/posts_routes.mjs`  
   `src/public/parts/shells/social/src/vault_crypto/vault.mjs`

2. 联邦入站有签名/owner 边界校验：  
   `src/public/parts/shells/social/src/timeline/sync.mjs`

3. 关系操作已有 follow / block / hide / follow-approve：  
   `src/public/parts/shells/social/src/endpoints/relationships_routes.mjs`

4. 发现、搜索、趋势、通知已经形成闭环：  
   `src/public/parts/shells/social/src/discovery.mjs`  
   `src/public/parts/shells/social/src/search.mjs`  
   `src/public/parts/shells/social/src/trending/hashtags.mjs`  
   `src/public/parts/shells/social/src/notifications.mjs`

5. 测试覆盖了单测、集成、前端、live：  
   `src/public/parts/shells/social/test/manifest.json`

## 五、最关键的负面证据

1. `chat` 搜索是前端过滤，而不是后端全文搜索：  
   `src/public/parts/shells/chat/public/hub/wireHeaderEvents.mjs`

2. `social` 搜索是在已知时间线中扫描：  
   `src/public/parts/shells/social/src/search.mjs`

3. `social` 趋势是从观看者可见帖子里本地统计：  
   `src/public/parts/shells/social/src/trending/hashtags.mjs`

4. `social` 通知是现算 + localStorage 已读：  
   `src/public/parts/shells/social/src/notifications.mjs`  
   `src/public/parts/shells/social/public/src/views/notifications.mjs`

5. `chat` 通知仅见浏览器 Notification：  
   `src/public/parts/shells/chat/public/hub/hubNotifications.mjs`

6. `social` 联邦不是 ActivityPub：  
   `src/public/parts/shells/social/public/llms.txt`

7. `social` live websocket 测试当前仍偏 smoke：  
   `src/public/parts/shells/social/test/live/scripts/ws_test.mjs`

## 六、当前阶段最合理的定位

我会把当前 `fount social/chat` 定位为：

- **不是**生产级聊天/社交成品
- **是**高质量、架构认真、方向清晰的联邦社交/聊天系统原型
- **尤其适合**继续打磨成“偏协议/自治/联邦特色”的产品，而不是去硬追大厂中心化平台的全部特性

也就是说，它最有价值的地方，不是“已经像 QQ/Discord/Twitter 一样完善”，而是：

- 联邦与本地副本思路清晰
- 信任边界意识较强
- 权限/加密/归档做得认真
- 有继续走向严肃系统的基础

## 七、建议优先级

### 必须补（不补很难自称生产级）

1. 统一未读/已读/通知状态模型，做到服务端持久化与多端同步。
2. 建立真正的搜索索引层，覆盖聊天历史、社交帖子、跨频道/跨时间范围检索。
3. 补齐 push / web push / 更可靠的通知链路。
4. 为 social 增加最基本的审核/举报/静音/内容警告机制。
5. 建立更明确的可观测性体系：指标、延迟、错误率、同步失败率、存储压力。

### 应该补（补完会明显更像可长期运营的软件）

1. 让 social 通知从“现算”升级为持久 inbox。
2. 给 chat/social 增加更明确的大数据量读路径优化与索引设计。
3. 增强实时链路测试，不只验证 hello / smoke，还验证断线重连、丢包、乱序、回放。
4. 完整梳理移动端与后台行为。
5. 把风控/信誉/封禁策略做成可解释、可审计的产品层能力。

### 可以后补（产品化增强项）

1. Discord/QQ 风格更完整的 AV / 直播 / 共享体验。
2. Twitter/Mastodon 风格更成熟的推荐、趋势、列表与公开 API 生态。
3. 若目标是公开联邦生态，再考虑 ActivityPub 兼容层或桥接层。

## 八、附：本次判断依据

本报告基于以下输入整理：

- 对 `chat` / `social` / `p2p` 相关代码与指南的只读审阅
- 测试清单与少量已有测试报告
- 对联邦边界、存储路径、通知模型、搜索模型、测试覆盖范围的代码比对

本报告**不是**基于完整压测、长期线上观测或全量 live 测试得出，因此它更偏“架构与实现成熟度评估”，而不是“真实线上 SLA 认证报告”。
