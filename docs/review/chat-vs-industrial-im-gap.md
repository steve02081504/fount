# fount Chat 与工业化 IM 差距审阅

最后核对：`2026-07-18`（对照仓库代码；已落地能力不复述，只列差距）

## 范围

对照：Signal、Discord、Tox、QQ、微信、Line。对象：`shells:chat` + 联邦/P2P（`src/server/p2p_server/`、`fount-p2p`）。方法：以代码、`public/llms.txt`、`AGENTS.md` 与集成测试为准；**不引用开发规划文档**（未排期方向见关联档）。

关联：[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)、[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)。

图例：**无** = 未见一等能力 · **弱** = 有雏形或形态不同 · **部分** = 有 API/后端但产品面不全。

---

## 结论摘要

社群 IM 主路径（频道/权限/反应/置顶/投票/子线程、内联 `replyTo` 基础版、mute/care、`@mention` inbox、搜索、Web Push、转发、草稿 localStorage、离线发送队列、投递态、群组通话含屏幕共享、联邦 Mailbox/EVFS、桥接 bot）已齐。与工业化 IM 的残差集中在四类：

1. **载体与触达**：仅 Web Hub / PWA；无 APNs/FCM、无 QR 关联设备、无中心化账号恢复；节点离线收信弱于常驻代理。
2. **消息手感残差**：语音为录音附件；无定时/阅后即焚；无 Signal 式单条已读回执；quote-reply 缺工业 polish（气泡跨页补全预览、线程聚合计数等）；无 GIF 商店 / Slash·Bot UX；无频道级 NSFW 门控。
3. **规模与 AV**：单进程 av-relay + 稀疏 WebRTC；无独立 1:1 通话 / Stage / 专用通话历史；无投递 SLA（`delivered` = 本机 WS 回显，非联邦送达证明）。
4. **治理、生态与联邦对称**：无举报工单；无企业 SSO/合规导出/Bot 商店；无支付/小程序；social↔chat 仅深链 + agent `replyViaChat`；远端 persona 仅群 RPC 代理、plugin 仍本机；无 ActivityPub 等异构互通。

---

## 一、载体与触达

| 维度 | 工业化 IM | fount |
| --- | --- | --- |
| 客户端 | iOS / Android / 桌面原生 | **Web Hub** + PWA；需自跑 fount |
| 账号恢复 | 手机/邮箱/OAuth | operator 密钥；**无**中心化「忘密码」 |
| 联系人发现 | 通讯录、扫码、推荐 | mDNS/Nostr、邀请码/深链、本地 discovery、`entities/search`（handle / 联邦） |
| 后台通知 | APNs / FCM / 系统推送 | **部分**：Web Push；APNs/FCM **无** |
| 多设备 | QR 关联设备、会话同步 | 多端 `read_marker` WS 有；**无** QR link-device / 设备管理 UI |
| 常驻收信 | 云端/手机代理 | 本机在线；离线靠 Mailbox（节点级，非手机代理） |
| 云备份 | 聊天记录上云 | 本地 DAG；list UI 本机 import/export + 频道可移植归档（非托管） |

产品边界「明确不做」原生 App / APNs / FCM——残差是刻意的。

---

## 二、消息体验

| 功能 | 现状 vs 目标 |
| --- | --- |
| **语音消息（工业 UX）** | Hub 录音 → `.wav` 附件（`composerFiles.mjs`）+ 通用 `<audio>`；**无**按住说话 / 波形预览 / 转写。`voiceRing.mjs` 属群组通话 UI，勿与语音消息混淆 |
| **定时发送** | **无**（social 有 `publishAt` + watcher；chat 发信路径无对等队列。`timerTrigger` 是 char 定时回复，不是用户定时发信） |
| **阅后即焚** | **无** ephemeral TTL / 阅后删事件（现有 `ttl` 均为联邦 RPC/gossip/mailbox 语义） |
| **单条已读回执** | 频道 `read-marker` + 已读人数角标（`member-read-markers` 用 **seq 水位推算**）；**无** Signal 式 per-message receipt DAG 事件 |
| **内联 quote-reply** | **部分**：`content.replyTo` + composer 横幅（`composerReply.mjs`）+ `quote_block` 气泡（`blocks.mjs`）+ 点击跳转 `ensureMessageLoaded`；与子线程（`threadDrawer`）并存。父消息不在当前页时气泡预览可退化为 `…`（**渲染不主动拉父消息**）；无 `replyCount` / 线程侧栏聚合 |
| **GIF / 贴纸商店** | 本地 sticker pack + import + docked picker；**无** Tenor/Giphy 级远程 picker |
| **Slash / Bot 交互 UI** | Hub **无** slash commands / reply keyboard；桥接 bot 是平台翻译层（`bridgeOperations`），不是 Discord 式 slash 注册面（`reputation_slash` 是联邦信誉，非 Bot UX） |
| **富链接预览** | 前端 markdown 裸链水合（`/api/no-cors` + OG）；非结构化入库 |
| **频道 NSFW / age gate** | 消息级 CW / `sensitive_media` 有；**无**频道旗标 + 进房确认门 |

形态不同、不算缺失但对标时勿当「已对齐」：

| 功能 | 工业常见 | fount |
| --- | --- | --- |
| 线程 | 主频道 quote + 可选独立线程 | 内联 `replyTo` **与** 独立子频道（thread drawer）双轨 |
| presence | 集群级实时 | profile status + heartbeat（轻量；非成员实时订阅总线） |
| 慢速模式 | 倒计时条 UX | `messageRateLimitPerMin` 数字设置（治理层有，UI 非 Discord 式倒计时） |
| 草稿 / 离线发 / 投递 | 成熟 | **已有**：`composerDraft.mjs`（localStorage）；`sendQueue.mjs`（离线排队 + online drain）；投递态 pending→sent→delivered（`delivered` = 己方消息 WS `channel_message` 回显，**非**联邦送达证明）——**勿再当缺口** |
| `@mention` inbox | 常与推送一体 | **已有** chat 内 per-entity inbox（`inbox.mjs` / `inboxView.mjs`）；≠ social→channel 结构化桥 |

增值能力（非工业对标核心缺口，附录备查）：消息可选翻译（`translate.mjs`）、拖拽导出 HTML（`messageDragExport.mjs`）、结构化转发 `forwardedFrom`。

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
| **公告频道** | pins 有；**无** announcement channel 专用类型（创建仅 text/list/streaming；只读广播语义无） |
| **超级 App** | 支付、小程序、公众号、游戏、直播电商、短信/通讯录集成——**无** |
| **social↔chat** | 深链（含 `?contact=`）+ agent `replyViaChat`；**无** mention→channel 结构化 ingress、chat→social 发帖草稿确认。chat `@mention` inbox 已有，勿与本项混读 |

桥接 bot（TG/DC/WeChat）：平台翻译层，不能抵消「无原生 IM App」与「Hub 无 Bot 商店 UX」。

交叉：social 举报同为有意不做，见 [social-platform-gap-analysis.md](./social-platform-gap-analysis.md)。

---

## 六、联邦对称与异构互通

| 缺口 | 现状 vs 目标 |
| --- | --- |
| persona 跨节点 | **现状**：群内远端 persona 经 `resolvePersona` → `createRemotePersonaProxy`，RPC 暴露 `GetPromptForOther` / `TweakPromptForOther` / `GetChatLogForViewer`（`remoteProxy.mjs` / `rpcDispatcher.mjs`）。**缺口**：仅限群会话 RPC 上下文；无实体级对称读写代理、无跨群 persona 联邦名单 |
| plugin 跨节点 | **现状**：`groups/{id}/local_plugins.json`（`localPlugins.mjs`）仅本机 replica，注释写明不入 DAG、不联邦；远端节点不自动加载他机 plugin 贡献 prompt。**目标**：plugin 联邦参与 prompt 贡献侧 |
| 异构互通 | **无** ActivityPub / Matrix / XMPP；仅 fount↔fount + 自有 bridge（产品边界不做 AP） |
| 远端托管 agent | 时间线 ingress **部分**：recovery 创世 + `entity_key_rotate` + 活跃钥发帖可引导入账（`timeline_ingress` 测）；陌生钥注入拒绝；本机 owner 签 `post_edit`/`post_delete` 已通。**仍缺**：跨节点 owner 对远端托管 agent 的内容写路径、nodeHash→operator 信任链；Chat `remoteProxy` 可读调 ≠ Social 写路径平权（见 [平权审阅 §2](./human-agent-operational-parity-review.md)） |

---

## 七、对照总表（差距侧）

| 能力域 | fount |
| --- | --- |
| 原生移动端 / 桌面 IM | **无**（Web + PWA） |
| 系统后台推送 | **部分**（Web Push；无 APNs/FCM） |
| QR 多设备 / 手机号发现 | **无** |
| 语音消息（工业 UX） | **部分**（录音附件） |
| 定时 / 阅后即焚 | **无** |
| 单条已读回执 | **部分**（频道水位 + 已读人数推算） |
| 富链接 unfurl 入库 | **部分**（前端 OG） |
| 内联 quote-reply | **部分**（`replyTo` + 子线程双轨；缺气泡跨页补全 / reply 计数） |
| Slash / Bot UX / GIF 商店 | **无**（本地 sticker 有） |
| 频道 NSFW / age gate | **无** |
| 独立 1:1 通话 / Stage / 通话历史 | **无** |
| 大规模 AV / SFU | **部分** |
| 消息投递 SLA | **无**（`delivered` ≠ 联邦证明） |
| Chat 举报闭环 | **无** |
| 企业 SSO / 合规导出 | **无** |
| Bot 商店 / OAuth | **无** |
| 支付/小程序 | **无** |
| social↔chat 结构化桥 | **无**（深链 + replyViaChat；chat @inbox 另计） |
| persona/plugin 联邦对称 | **部分**（persona 群 RPC；plugin 本机） |
| 元数据最小化（对标 Signal） | **弱** |
| 明文展示侧车（对标 Signal） | **有**（差距项） |

<details>
<summary>附录：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API | `src/public/parts/shells/chat/public/llms.txt` |
| Hub / Session / P2P | `hub/AGENTS.md`；`session/AGENTS.md`；`src/server/p2p_server/AGENTS.md` |
| 未读 / inbox / care | `lib/readMarkers.mjs`；`hub/unread.mjs`；`lib/inbox.mjs`；`hub/inboxView.mjs`；`care.mjs` |
| Web Push | `src/server/web_server/notify/webPush.mjs`；`service_worker.mjs` |
| 草稿 / 离线队列 / 投递 | `hub/composerDraft.mjs`；`hub/sendQueue.mjs`；`hub/messages/messageSend.mjs`；`stream/handlers/channelMessage.mjs` |
| 内联 quote-reply | `hub/composerReply.mjs`；`hub/messages/actions/reply.mjs`；`hub/messages/render/blocks.mjs`；`channelMessageStore.mjs` `ensureMessageLoaded` |
| 已读人数 | `hub/memberReadMarkers.mjs` |
| 语音附件 | `hub/composerFiles.mjs` |
| 通话 / 屏幕共享 | `hub/call.mjs`；`hub/codecsAv.mjs`；`ws/avRelay.mjs` |
| 翻译 / 拖拽导出 | `hub/messages/actions/translate.mjs`；`messageDragExport.mjs` |
| 深链 | `chat/public/shared/runUri.mjs`；`social/public/shared/runUri.mjs`；`deepLinkConsume.mjs` |
| Bridge | `chat/src/chat/bridge/` |
| 联邦 parts 边界 | `session/localPlugins.mjs`；`session/resolvePart.mjs`；`federation/remoteProxy.mjs` |

</details>

---

*本报告仅记录审阅时点差距；后续以仓库代码为准。*
