# fount Chat 与工业化 IM 差距审阅

最后核对：`2026-07-14`

## 范围

对照：Signal、Discord、Tox、QQ、微信、Line。对象：`shells:chat` + 联邦/P2P（`src/server/p2p_server/`、`fount-p2p`）。方法：以仓库代码、`public/llms.txt`、`AGENTS.md` 与集成测试为准；**不引用开发规划文档**——下文只陈述「代码里有什么 / 没有什么」。

关联审阅：[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)、[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)。

图例：**无** = 未见一等能力 · **弱** = 有雏形或形态不同 · **部分** = 有 API/后端但产品面不全。

---

## 结论摘要

fount chat 的底盘是 **联邦群/DM + DAG 事件 + CKG 频道加密 + Hub 读模型（view-log / inbox / 未读）**，Discord 级社群原语（频道分类、角色权限、反应/置顶/投票/贴纸、子线程、跨群搜索、mute/care、Web Push）与去中心化联邦（Mailbox、EVFS、gossip）已能跑通；桥接 bot（TG/DC/WeChat）可把异网消息接进同一对象模型。

与工业化 IM 的差距主要集中在五类：

1. **载体与触达**：Web Hub / PWA；Web Push 有、APNs/FCM 无；密码学身份无中心化恢复；联系人靠 P2P 发现/邀请码；节点离线收信弱于商业 IM 常驻代理。
2. **消息手感**：语音为录音附件；无定时/阅后即焚；无线程外 quote-reply。
3. **规模与 AV**：单进程 av-relay + 稀疏 WebRTC；无 1:1 通话 / 屏幕共享 / Stage / 通话历史；无消息投递 SLA。
4. **治理与运营**：chat 有 ban/kick/角色/审计/fork；**无举报闭环**（举报工单在 social，勿混栽）；无企业 SSO/合规导出/Bot 商店。
5. **生态与联邦对称**：无支付/小程序；social↔chat 仅深链；persona/plugin 无正式跨节点代理；无 ActivityPub 等异构互通。

以下分节只展开**差距**。已实现基线见附录 A。

---

## 一、差距：载体与触达

| 维度 | 工业化 IM | fount（代码现状） |
| --- | --- | --- |
| 客户端 | iOS / Android / 桌面原生 | **Web Hub** + PWA `manifest`（`protocol_handlers`）；需自跑 fount |
| 账号恢复 | 手机/邮箱/OAuth、云端换机 | operator 密钥；**无**「忘密码」中心化恢复 |
| 联系人发现 | 通讯录、扫码、推荐 | mDNS/Nostr、邀请码/深链、本地 discovery 索引 |
| 后台通知 | APNs / FCM / 系统推送 | **部分**：Web Push + Service Worker；APNs/FCM **无**；浏览器 `Notification` 条件极窄 |
| 多设备 | QR 关联设备、会话同步 | 多端 `read_marker` WS 同步有；**无** QR link-device / 设备管理产品面 |
| 常驻收信 | 云端/手机代理 | 本机节点在线；离线靠 Mailbox |
| 云备份 | 聊天记录上云 | 本地 DAG；list UI 可本机 import/export JSON（非托管备份） |

---

## 二、差距：消息体验与通知

### 2.1 缺失或偏弱

| 功能 | 说明 |
| --- | --- |
| **语音消息（工业 UX）** | Hub `#hub-voice-button` 录音 → `.wav` 附件（`composerFiles.mjs`）；无按住说话 / 波形 / 转写 |
| **转发** | **无**用户级「转到另一会话」。有站外 **share 深链**（`share.mjs`），≠ 转发 |
| **定时发送** | **无** |
| **阅后即焚** | **无** ephemeral TTL 消息类型 |
| **单条已读回执** | 仅频道 `read-marker` seq；**无** per-message receipts |
| **投递状态** | **无**气泡级 sent / delivered / failed ACK（文件层有 `chunkReplicationAck`，不进消息 UX） |
| **离线发送队列** | **无** pending/retry UI；联邦靠 Mailbox / gossip |
| **Composer 草稿** | **无**草稿持久化 API/UI |
| **富链接预览** | 前端 markdown 裸链接水合（`/api/no-cors` + OG）；非结构化入库 |
| **正文翻译** | **无**（social 侧有翻译缓存，chat 消息面无） |
| **内联 quote-reply** | **无**主频道内引用气泡；`parentEventId` 在 Hub 多用于 DAG 分支父边，≠ 工业回复引用 |
| **GIF / 贴纸商店** | 有本地 sticker pack + import；**无** Tenor/Giphy 级 picker |
| **Slash / Bot 交互 UI** | Hub **无** slash commands / reply keyboard / 交互按钮编曲；桥接 bot 是平台翻译层，不是 Discord/TG Bot UX |

### 2.2 有实现但未对齐工业 UX

| 功能 | 工业常见 | fount 现状 |
| --- | --- | --- |
| 线程 | 主频道内 quote-reply 线程 | 独立子频道（`POST …/threads`、`threadDrawer.mjs`） |
| presence | 集群级实时状态 | profile status + heartbeat（online/idle/dnd/invisible）；轻量 |
| typing | 对方正在输入 | WS VOLATILE `typing` + bridge `sendTyping`；有 |
| Spoiler / CW | 独立内容警告字段 | Markdown `\|\|text\|\|` spoiler 渲染；**无**独立 CW 字段 |
| 慢速模式 | 频道慢速倒计时 UX | `messageRateLimitPerMin` + `BYPASS_RATE_LIMIT`；设置数字，非 Discord 式倒计时条 |
| NSFW / age gate | 频道旗标 + 确认门 | **无** |

### 2.3 通知与会话组织（社群壳已齐，对标时勿当缺口）

下列相对 Discord/微信通知与侧栏组织**已具备**，只列以免误判为缺失：mute / notify-prefs、care（穿透 mute）、书签、侧栏群文件夹、petname aliases、`channel.category` 折叠分类。证据见附录 A。

---

## 三、差距：实时音视频与规模

| 维度 | 工业 IM | fount |
| --- | --- | --- |
| 媒体架构 | 区域 SFU 集群 | 单进程 `avRelay.mjs`；可嵌外部 SFU（`streamingSfuWss`） |
| 拓扑 | 媒体服务器 | 稀疏 WebRTC 网状，`rtcConnectionBudgetMax` 预算 |
| 规模 | 数百～数千人语音房 | 小社区量级 |
| QoS | simulcast、降噪、拥塞控制 | 基础 relay |
| 1:1 通话 | 语音/视频通话入口 | **无**独立通话会话；仅 streaming 频道房间式 |
| 屏幕共享 / Stage | 有 | **无** `getDisplayMedia` / Stage 产品面 |
| 通话历史 | 有 | **无** |
| 投递 SLA | 中心化队列 | DAG gossip/catchup；**无** SLA |

---

## 四、差距：安全与隐私（路线差异，非单纯落后）

| 维度 | Signal | fount |
| --- | --- | --- |
| 信任模型 | Fast blind relay | 联邦 DAG；参与者可见拓扑/元数据 |
| 群加密 | Sender Keys 等 | CKG + DAG 签名上下文；DAG `events.jsonl` = GSH 密文 |
| 本地展示存储 | 解密后仅本地 | `messages/{channelId}.jsonl` **明文展示侧车**（≠ 全盘明文） |
| 元数据 | sealed sender 等 | 信任图 / 信誉 / denylist；**弱**于 Signal |
| 上手 | 装 App + 手机号 | 节点 / 联邦 / 邀请码 / 密钥 |
| 截图防护 | 部分 App 有 | **无** |

相对 Tox：同属去中心化，但叠加 AI/world/DAG 治理，纯传话简洁性更差。  
相对 QQ/微信：无服务端可读审核/推荐/监管对接链。

---

## 五、差距：治理、合规与运营

### 5.1 Chat 治理缺口

| 缺口 | 说明 |
| --- | --- |
| **举报闭环** | chat shell **无** report 路由 / 审核工单。角色权限、ban/kick、审计日志、fork、信誉、personal block/hide、denylist、owner-succession **已有** |
| **自动审核** | **无** |
| **企业** | **无** SSO、eDiscovery、合规导出、管理控制台（list 本机 JSON 导出 ≠ eDiscovery） |
| **Bot 生态** | parts / ChatClient / bridgeOperations 可编程；**无** OAuth 托管与商店 |
| **商业运营层** | **无**官方表情/主题商店、付费增值 |
| **公告频道语义** | pins 有；**无** announcement channel 专用类型 |

交叉引用：社交侧举报 + resolve API + 审核 UI（`social/.../governance`、`moderation.mjs`）见 [social-platform-gap-analysis.md](./social-platform-gap-analysis.md)——**不要**把 social 的 resolve API 写成 chat 能力。

### 5.2 超级 App 生态（QQ/微信/Line）

- 支付、小程序、公众号、游戏、直播电商——**无**
- 运营商短信/电话簿集成——**无**
- 算法推荐/官方内容运营——**无**
- social↔chat：**仅** `socialRunUri.mjs` / `runUri.mjs` 深链（另有 social→chat 的 agent `replyViaChat`，非产品级双向桥）；**无** mention→chat ingress、chat→social 发帖等结构化后端桥

### 5.3 桥接 bot（异构入口，非原生客户端）

Telegram / Discord / WeChat bot 壳经 `registerBridgeOperations` 接入同一 `ChatClient` 鸭子类型；入站可带 `replyToEventId`、typing 等。这是**平台翻译层**，不能抵消「无原生 IM App」与「Hub 无 Bot 商店 UX」。

---

## 六、差距：联邦对称与异构互通

| 缺口 | 说明 |
| --- | --- |
| persona 跨节点 | **无**正式 remote persona proxy（仍有 `extension.otherPersona` 特判空间，非正式对称） |
| plugin 跨节点 | 联邦未对称参与 prompt 等链路；插件仅本机 `session.plugins[replica]` |
| 异构互通 | **无** ActivityPub / Matrix / XMPP；仅 fount↔fount + 自有 bridge bots |
| 远端托管 agent | 跨节点 agent 写路径 / 时间线授权未闭合（平权残余另见 human-agent 审阅） |

<details>
<summary>联邦已覆盖项（默认折叠）</summary>

群/消息/文件：DAG sync、Mailbox、fed_chunk、emoji CAS、discovery announce、partition bridge 等；world：`remoteWorldProxy` + `rpcDispatcher`。证据：`llms.txt`、`src/server/p2p_server/AGENTS.md`。

</details>

---

## 七、对照总表（仅列差距侧）

| 能力域 | fount |
| --- | --- |
| 原生移动端 / 桌面 IM | **无**（Web + PWA） |
| 系统后台推送 | **部分**（Web Push；无 APNs/FCM） |
| QR 多设备 / 手机号发现 | **无** |
| 语音消息（工业 UX） | **部分**（录音附件） |
| 消息转发 / 定时 / 阅后即焚 | **无** |
| 单条已读 / 气泡投递态 / 离线发送队列 | **无** |
| Composer 草稿 | **无** |
| 富链接 unfurl / 正文翻译 | 前端 embed 水合 + `/translate` |
| 内嵌 quote-reply 线程 | **部分**（子频道） |
| Slash / Bot 交互 UI / GIF 商店 | **无** |
| 1:1 通话 / 屏幕共享 / Stage / 通话历史 | **无** |
| 大规模 AV / SFU | **部分** |
| 消息投递 SLA | **无** |
| Chat 举报闭环 | **无** |
| 企业 SSO / 合规导出 | **无** |
| Bot 商店 / OAuth 托管 | **无** |
| 支付/小程序生态 | **无** |
| social↔chat 结构化桥 | **无**（深链 + agent replyViaChat） |
| persona/plugin 联邦对称 | **无** |
| 元数据最小化（对标 Signal） | **弱** |
| 本地明文展示侧车（对标 Signal） | **有**（差距项；DAG 仍密文） |

<details>
<summary>对照总表：fount 已对齐或异构长板（默认折叠）</summary>

| 能力域 | fount |
| --- | --- |
| 频道/分类/权限/反应/置顶/表情/贴纸 | 对齐 Discord 核心社群原语 |
| typing / presence（轻量） | 有 |
| 群内+跨群全文搜索 | 有 |
| @mention inbox / 角色组 @ / care / mute prefs | 有 |
| 投票生命周期通知 | 有 |
| 频道级未读水位 + 多端 read_marker | **部分**（无单条回执） |
| 去中心化联邦 / Mailbox / EVFS | 有 |
| Bridge bots（TG/DC/WeChat） | 异构入口 |
| AI char/world/persona / ChatClient | 异构，工业 IM 无对标 |
| 可分叉治理 / owner-succession | 异构 |
| 本机会话 import/export | 有（非云备份） |

</details>

---

<details>
<summary>附录 A：已实现基线（审阅时点，默认折叠）</summary>

社群 IM MVP 已落地，此处仅作对标参照。

| 域 | 能力 | 证据 |
| --- | --- | --- |
| 协议 | 联邦群/DM、DAG、CKG、热/冷归档、Mailbox | `public/llms.txt`；`src/server/p2p_server/AGENTS.md` |
| 频道 | 文本/列表/流媒体、分类、树形 parent、角色 ACL、ban/kick、反应/置顶/投票、子线程、fork/信誉/denylist | `llms.txt`；`groupNav.mjs`；`threadDrawer.mjs` |
| 消息 CRUD | edit/delete、attachments、反馈 | `channelMessages.mjs`；`composerFiles.mjs` |
| 表情/贴纸 | 群 emoji CAS、用户贴纸包 import、picker | `stickers/`；`pages/.../stickerPicker.mjs` |
| Spoiler | Markdown spoiler 渲染 | `pages/scripts/features/markdown/convertor.mjs` |
| 搜索 | 群内 + 跨群 | `search/`；`endpoints/globalSearch.mjs` |
| Mentions / inbox | entity + `@[role:…]` / everyone/here；per-entityHash inbox；care | `inlineTokenSyntax.mjs`；`inbox.mjs`；`care.mjs` |
| 未读 | channel seq + read-marker；多端 WS | `readMarkers.mjs`；`hub/unread.mjs` |
| 通知 | Web Push + SW；mute / mode prefs | `server/web_server/notify/`；`endpoints/preferences.mjs`；`messageFanout.mjs` |
| Presence / typing | status + heartbeat；WS volatile typing | `hubStatus.mjs`；`presence.mjs`；`bridge/typing.mjs` |
| 组织 | bookmarks、group-folders、aliases、`channel.category` | `pinsBookmarks.mjs`；`serverBar.mjs`；`shared/aliases.mjs` |
| 文件 | 群分片、folder ops、断点续传、EVFS | `llms.txt` §群文件 |
| AV | streaming channel + av-relay / 外嵌 SFU | `codecsAv.mjs`；`ws/avRelay.mjs` |
| 审计 | audit-log API + 设置面板 | `auditLog.mjs` |
| 会话备份 | list import/export JSON | `public/list/` |
| Bridge | TG/DC/WeChat → `bridgeOperations` | `chat/src/chat/bridge/`；`shells/*bot/` |
| 读写钩子 | view-log、persona/world、`WorldChatHost`、`ChatClient`（实体自签） | `session/AGENTS.md`；`api/index.mjs` |
| 限流 | `messageRateLimitPerMin` | `messageRateLimit.mjs` |

</details>

<details>
<summary>附录 B：审阅意见（按目标场景）</summary>

**替代微信/Line 作为日常 IM**：缺口在原生客户端、APNs/FCM、云账号恢复、通讯录发现、常驻离线收信——属产品载体 + 触达。

**Discord 级社区**：社群原语已近；优先缺口在大规模 AV、内嵌 reply UX、unfurl、Bot OAuth/商店、慢速/NSFW 产品叙事——属媒体规模 + 手感/生态。

**Signal 级隐私**：CKG/GSH 与本地优先已在路上；缺口在元数据面（sealed sender 类）、明文侧车策略、联邦参与者可见性——属隐私路线取舍，不是缺功能清单。

**联邦 parts 完整度 / human-agent 联用**：优先 remote persona/plugin、social↔chat 后端桥、远端 agent 写路径——与 [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) 残余缺口叠合；工业 checkbox（Stories 式功能）不应挤掉这些。

</details>

<details>
<summary>附录 C：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API 总览 | `src/public/parts/shells/chat/public/llms.txt` |
| Hub | `src/public/parts/shells/chat/public/hub/AGENTS.md` |
| Session | `src/public/parts/shells/chat/src/chat/session/AGENTS.md` |
| P2P | `src/server/p2p_server/AGENTS.md` |
| 搜索 | `src/public/parts/shells/chat/src/chat/search/`；`endpoints/globalSearch.mjs` |
| 未读 | `src/public/parts/shells/chat/src/chat/lib/readMarkers.mjs`；`hub/unread.mjs` |
| Inbox / care | `src/public/parts/shells/chat/src/chat/lib/inbox.mjs`；`care.mjs` |
| 通知分发 | `src/public/parts/shells/chat/src/chat/dag/messageFanout.mjs` |
| Web Push | `src/server/web_server/notify/webPush.mjs`；`src/public/pages/service_worker.mjs` |
| 通知偏好 | `src/public/parts/shells/chat/src/endpoints/prefs.mjs`；`public/shared/notifyPrefs.mjs` |
| 语音附件 | `src/public/parts/shells/chat/public/hub/composerFiles.mjs` |
| 站外分享 | `src/public/parts/shells/chat/public/src/share.mjs` |
| social 深链 | `src/public/parts/shells/chat/public/shared/socialRunUri.mjs` |
| Bridge | `src/public/parts/shells/chat/src/chat/bridge/` |
| 会话导出 | `src/public/parts/shells/chat/public/list/` |
| AV relay | `src/public/parts/shells/chat/src/chat/ws/avRelay.mjs` |

</details>

---

*本报告仅记录审阅时点代码事实与对标差距，不维护实施状态；后续以仓库代码为准更新认知。*
