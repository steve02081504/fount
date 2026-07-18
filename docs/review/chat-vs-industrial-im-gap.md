# fount Chat 与工业化 IM 差距审阅

最后核对：`2026-07-18`（对照仓库代码；已落地能力不复述，只列差距）

## 范围

对照：Signal、Discord、Tox、QQ、微信、Line。对象：`shells:chat` + 联邦/P2P（`src/server/p2p_server/`、`fount-p2p`）。方法：以代码、`public/llms.txt`、`AGENTS.md` 与集成测试为准；**不引用开发规划文档**（未排期方向见关联档）。

关联：[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)、[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)。

图例：**无** = 未见一等能力 · **弱** = 有雏形或形态不同 · **部分** = 有 API/后端但产品面不全。

---

## 结论摘要

社群 IM 主路径（频道/权限/反应/置顶/投票/子线程、mute/care、搜索、Web Push、转发、草稿 localStorage、离线发送队列、投递态、群组通话含屏幕共享、联邦 Mailbox/EVFS、桥接 bot）已齐。与工业化 IM 的残差集中在四类：

1. **载体与触达**：仅 Web Hub / PWA；无 APNs/FCM、无 QR 关联设备、无中心化账号恢复；节点离线收信弱于常驻代理。
2. **消息手感残差**：语音为录音附件；无定时/阅后即焚；无线程外工业式 quote-reply；无 GIF 商店 / Slash·Bot UX；无频道级 NSFW 门控。
3. **规模与 AV**：单进程 av-relay + 稀疏 WebRTC；无独立 1:1 通话 / Stage / 专用通话历史；无投递 SLA。
4. **治理、生态与联邦对称**：无举报工单；无企业 SSO/合规导出/Bot 商店；无支付/小程序；social↔chat 仅深链 + agent `replyViaChat`；persona/plugin 无正式跨节点代理；无 ActivityPub 等异构互通。

---

## 一、载体与触达

| 维度 | 工业化 IM | fount |
| --- | --- | --- |
| 客户端 | iOS / Android / 桌面原生 | **Web Hub** + PWA；需自跑 fount |
| 账号恢复 | 手机/邮箱/OAuth | operator 密钥；**无**中心化「忘密码」 |
| 联系人发现 | 通讯录、扫码、推荐 | mDNS/Nostr、邀请码/深链、本地 discovery、`entities/search`（handle） |
| 后台通知 | APNs / FCM / 系统推送 | **部分**：Web Push；APNs/FCM **无** |
| 多设备 | QR 关联设备、会话同步 | 多端 `read_marker` WS 有；**无** QR link-device / 设备管理 UI |
| 常驻收信 | 云端/手机代理 | 本机在线；离线靠 Mailbox（节点级，非手机代理） |
| 云备份 | 聊天记录上云 | 本地 DAG；list UI 本机 import/export（非托管） |

产品边界「明确不做」原生 App / APNs / FCM——残差是刻意的。

---

## 二、消息体验

| 功能 | 现状 vs 目标 |
| --- | --- |
| **语音消息（工业 UX）** | Hub 录音 → `.wav` 附件（`composerFiles.mjs`）；**无**按住说话 / 波形预览 / 转写。目标若对齐需专用 bubble + 媒体类型，而非通用附件 |
| **定时发送** | **无**（social 有 `publishAt` + watcher；chat 发信路径无对等队列） |
| **阅后即焚** | **无** ephemeral TTL / 阅后删事件 |
| **单条已读回执** | 频道 `read-marker` + 已读人数角标（`member-read-markers` 侧车）；**无** Signal 式 per-message receipt |
| **内联 quote-reply** | 回复入口为子线程（`threadDrawer.mjs` → 独立子频道）；DAG 父边引用条 ≠ 工业主频道内嵌引用气泡 |
| **GIF / 贴纸商店** | 本地 sticker pack + import；**无** Tenor/Giphy 级远程 picker |
| **Slash / Bot 交互 UI** | Hub **无** slash commands / reply keyboard；桥接 bot 是平台翻译层（`bridgeOperations`），不是 Discord 式 slash 注册面 |
| **富链接预览** | 前端 markdown 裸链水合（`/api/no-cors` + OG）；非结构化入库 |
| **频道 NSFW / age gate** | 消息级 CW / `sensitive_media` 有；**无**频道旗标 + 进房确认门 |

形态不同、不算缺失但对标时勿当「已对齐」：

| 功能 | 工业常见 | fount |
| --- | --- | --- |
| 线程 | 主频道内 quote-reply | 独立子频道（thread drawer） |
| presence | 集群级实时 | profile status + heartbeat（轻量；非成员实时订阅总线） |
| 慢速模式 | 倒计时条 UX | `messageRateLimitPerMin` 数字设置（治理层有，UI 非 Discord 式倒计时） |
| 草稿 / 离线发 | 成熟 | **已有**：`composerDraft.mjs`（localStorage）；`sendQueue.mjs`（离线排队 + online drain）；投递态 pending→sent→delivered——**勿再当缺口** |

---

## 三、实时音视频与规模

| 维度 | 工业 IM | fount |
| --- | --- | --- |
| 媒体架构 | 区域 SFU 集群 | 单进程 `avRelay.mjs`；可嵌外部 SFU（`streamingSfuWss`） |
| 拓扑 | 媒体服务器 | 稀疏 WebRTC，`rtcConnectionBudgetMax` |
| 规模 | 数百～数千人语音房 | 小社区量级 |
| QoS | simulcast、降噪、拥塞控制 | 基础 relay |
| 1:1 通话 | 独立语音/视频入口 | **无**；仅频道通话（`call.mjs` → `/ws/.../call/:groupId/:channelId`）与 streaming 房间 |
| Stage | Discord Stage | **无**（无观众/上台角色模型） |
| 通话历史 | 专用历史 UI | **无**（频道内 `content.type:'call'` 卡片 ≠ 通话历史列表） |
| 投递 SLA | 中心化队列 | DAG gossip；**无** SLA / 送达证明服务 |

屏幕共享：群组通话 / 流媒体已接 `getDisplayMedia`（`codecsAv.mjs` / `call.mjs`）——**勿再当缺口**。

---

## 四、安全与隐私（路线差异）

| 维度 | Signal | fount |
| --- | --- | --- |
| 信任模型 | Fast blind relay | 联邦 DAG；参与者可见拓扑/元数据 |
| 元数据 | sealed sender 等 | 信任图 / 信誉 / denylist；**弱**于 Signal |
| 上手 | App + 手机号 | 节点 / 联邦 / 邀请码 / 密钥 |
| 截图防护 | 部分 App 有 | **无** |
| 本地展示 | 解密后仅本地 | `messages/{channelId}.jsonl` **明文展示侧车**（DAG 仍密文） |

相对 Tox：同属去中心化，但叠加 AI/world/DAG 治理，纯传话简洁性更差。  
相对 QQ/微信：无服务端可读审核/推荐/监管对接链。

---

## 五、治理、合规与运营

| 缺口 | 说明 |
| --- | --- |
| **举报闭环** | chat / social **均无** report 工单（本机自理 mute/block/ban） |
| **自动审核** | **无** |
| **企业** | **无** SSO、eDiscovery、合规导出（频道 archive JSON 导出 ≠ eDiscovery） |
| **Bot 生态** | parts / bridge 可编程；**无** OAuth 托管与商店 |
| **商业运营** | **无**官方表情/主题商店、付费增值 |
| **公告频道** | pins 有；**无** announcement channel 专用类型（只读广播语义） |
| **超级 App** | 支付、小程序、公众号、游戏、直播电商、短信/通讯录集成——**无** |
| **social↔chat** | 深链（含 `?contact=`）+ agent `replyViaChat`；**无** mention→channel 结构化 ingress、chat→social 发帖草稿确认 |

桥接 bot（TG/DC/WeChat）：平台翻译层，不能抵消「无原生 IM App」与「Hub 无 Bot 商店 UX」。

交叉：social 举报同为有意不做，见 [social-platform-gap-analysis.md](./social-platform-gap-analysis.md)。

---

## 六、联邦对称与异构互通

| 缺口 | 现状 vs 目标 |
| --- | --- |
| persona 跨节点 | **现状**：`personaForOther` 经 serializable RPC 把 `{ ownerUsername, personaname }` 带给远端 `getChatRequest`（`chatRequest.mjs` / `serializableRequest.mjs`）——仅 GetReply 上下文特判。**目标**：正式 remote persona proxy（对称读写），而非一次性 RPC 字段 |
| plugin 跨节点 | **现状**：`session.plugins[replica]` 仅本机名单；远端节点不自动加载他机 plugin 贡献 prompt。**目标**：plugin 联邦参与 prompt 贡献侧 |
| 异构互通 | **无** ActivityPub / Matrix / XMPP；仅 fount↔fount + 自有 bridge（产品边界不做 AP） |
| 远端托管 agent | 跨节点写路径 / 时间线授权未闭合；Chat `remoteProxy` 可读调 ≠ Social ingress 平权（见 [平权审阅 §3](./human-agent-operational-parity-review.md)） |

---

## 七、对照总表（差距侧）

| 能力域 | fount |
| --- | --- |
| 原生移动端 / 桌面 IM | **无**（Web + PWA） |
| 系统后台推送 | **部分**（Web Push；无 APNs/FCM） |
| QR 多设备 / 手机号发现 | **无** |
| 语音消息（工业 UX） | **部分**（录音附件） |
| 定时 / 阅后即焚 | **无** |
| 单条已读回执 | **部分**（频道水位 + 已读人数） |
| 富链接 unfurl 入库 | **部分**（前端 OG） |
| 内嵌 quote-reply 线程 | **部分**（子频道） |
| Slash / Bot UX / GIF 商店 | **无** |
| 频道 NSFW / age gate | **无** |
| 独立 1:1 通话 / Stage / 通话历史 | **无** |
| 大规模 AV / SFU | **部分** |
| 消息投递 SLA | **无** |
| Chat 举报闭环 | **无** |
| 企业 SSO / 合规导出 | **无** |
| Bot 商店 / OAuth | **无** |
| 支付/小程序 | **无** |
| social↔chat 结构化桥 | **无**（深链 + replyViaChat） |
| persona/plugin 联邦对称 | **无**（仅 personaForOther 特判） |
| 元数据最小化（对标 Signal） | **弱** |
| 明文展示侧车（对标 Signal） | **有**（差距项） |

<details>
<summary>附录：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API | `src/public/parts/shells/chat/public/llms.txt` |
| Hub / Session / P2P | `hub/AGENTS.md`；`session/AGENTS.md`；`src/server/p2p_server/AGENTS.md` |
| 未读 / inbox / care | `lib/readMarkers.mjs`；`hub/unread.mjs`；`lib/inbox.mjs`；`care.mjs` |
| Web Push | `src/server/web_server/notify/webPush.mjs`；`service_worker.mjs` |
| 草稿 / 离线队列 / 投递 | `hub/composerDraft.mjs`；`hub/sendQueue.mjs`；`hub/messages/messageSend.mjs` |
| 语音附件 | `hub/composerFiles.mjs` |
| 通话 / 屏幕共享 | `hub/call.mjs`；`hub/codecsAv.mjs`；`ws/avRelay.mjs` |
| 深链 | `chat/public/shared/runUri.mjs`；`social/public/shared/runUri.mjs`；`deepLinkConsume.mjs` |
| Bridge | `chat/src/chat/bridge/` |
| 联邦 parts 边界 | `llms.txt`（plugin 本机）；`session/chatRequest.mjs`（`personaForOther`）；`federation/remoteProxy.mjs` |

</details>

---

*本报告仅记录审阅时点差距；后续以仓库代码为准。*
