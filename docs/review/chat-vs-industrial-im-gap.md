# fount Chat 与工业化 IM · 主路径残差

最后核对：`2026-07-20`。写法：[docs/AGENTS.md](../AGENTS.md)。已落地能力不复述；博物馆功能与产品边界「明确不做」项不进摘要。

关联：[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)、[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)、[chat-social-cabinet-tech-stack.md](./chat-social-cabinet-tech-stack.md)。

---

## 结论摘要

社群 IM 主路径（频道/权限/反应/置顶/投票/子线程、内联 `replyTo`、mute/care、`@mention` inbox、搜索、Web Push、转发、草稿 localStorage、离线发送队列、投递态、群组通话含屏幕共享、联邦 Mailbox/EVFS、桥接 bot）**已齐**。

一人一台日常会碰到的残差：

1. **消息手感缝**：语音是点击开停录音 → `.wav` 附件（无按住说话/波形）；无用户定时发信；引用父消息不在当前页时常显示 `…`（导航补拉走 raw `batch-get`，见 [tech-stack §2](./chat-social-cabinet-tech-stack.md)）；无频道级 NSFW 进房门控。
2. **已读语义**：频道水位推算；己方消息角标仅三态（发送中 / 已发送 / 别人已读），非 Signal 式单条回执。
3. **AV 规模**：单进程 av-relay + 稀疏 WebRTC；适合小社区，无独立 1:1 / Stage。
4. **隐私展示侧车**：`messages/{channelId}.jsonl` 明文（DAG 仍密文）——对标 Signal 是差距。

---

## 一、载体（有意边界）

Web Hub + PWA；Web Push 有；**无**原生 App / APNs / FCM（产品边界「明确不做」）。账号 = operator 密钥，无中心化「忘密码」。联系人发现（mDNS/Nostr/邀请码/`entities/search`）已有。多端 `read_marker` WS 有；无 QR link-device UI（仅有入群邀请 QR）。

---

## 二、消息体验

| 功能 | 路径 | 用户可见缺口 | Not this |
| --- | --- | --- | --- |
| **语音消息** | **主路径**：composer 点击开/停 → `.wav` 附件 + `<audio>`（`toggleVoiceRecording`） | 无按住说话 / 波形 / 转写 | 不是通话 `voiceRing`；不是「不能发语音」 |
| **定时发送** | **主路径**缺用户预约发信 | 不能预约发信 | 不是 social `publishAt`；不是 char `timerTrigger` |
| **内联 quote-reply** | **主路径**：能回复、有引用条、可跳转加载 | 父消息不在 `messagesByEventId` 时预览常 `…`；无回复数角标 | 不是子频道 thread drawer 坏了；导航补拉走 raw `batch-get`（见 [tech-stack §2](./chat-social-cabinet-tech-stack.md)） |
| **单条已读** | **主路径**：`member-read-markers` 用 seq 水位 → 双勾 | 无 per-message receipt；不展示已读人数 | 不是投递角标 pending→sent；不是 Mailbox 送达证明 |
| **频道 NSFW gate** | **主路径**缺频道进房门控 | 无频道旗标 + 进房确认 | 不是消息级 CW / `sensitive_media`（已有） |
| **富链接** | **主路径**：前端 OG 水合 | 非结构化入库 | 不是完全无预览 |

已齐、勿当缺口：草稿（`composerDraft`）、离线队列（`sendQueue`）、投递角标 pending→sent→read（读态来自成员水位，非联邦送达证明）、`@mention` inbox、本地 sticker pack、屏幕共享。

形态不同（非漏实现）：内联 `replyTo` **与** 子频道 thread drawer 双轨；慢速模式有 `messageRateLimitPerMin` 数字设置，无 Discord 式倒计时条。

---

## 三、实时音视频

| 维度 | 现状 |
| --- | --- |
| 架构 | 单进程 `avRelay.mjs`；可嵌外部 SFU（`streamingSfuWss`） |
| 入口 | 仅频道通话（`call.mjs`）；**无**独立 1:1 / Stage / 专用通话历史列表 |
| 规模 | 小社区量级；基础 relay，无工业 simulcast 集群 |

屏幕共享已接 `getDisplayMedia`——勿再当缺口。

---

## 四、安全与联邦

| 项 | 说明 |
| --- | --- |
| 明文展示侧车 | `messages/{channelId}.jsonl` 明文；DAG 事件仍密文 |
| 元数据 | 信任图 / 信誉 / denylist；弱于 Signal sealed sender（路线差异） |
| persona 跨节点 | 群内远端 persona 经 `createRemotePersonaProxy`（RPC）✅；无实体级对称读写代理 |
| plugin 跨节点 | `local_plugins.json` **仅本机**，不入 DAG、不联邦 |
| social↔chat 结构化桥 | 深链 + `replyViaChat`；无 mention→channel ingress（未排期） |

---

## 五、有意不做 / 博物馆（不进摘要计数）

| 类 | 项 |
| --- | --- |
| 产品边界 | 原生 App、APNs/FCM、ActivityPub / Matrix / XMPP |
| 本机自理 | 举报工单、自动审核 |
| 博物馆 | 阅后即焚、GIF 远程商店、Slash/Bot 注册面、企业 SSO/eDiscovery、Bot 商店、支付/小程序、截图防护 |
| 边缘 | 跨节点主人改删所属 agent Social 帖——见 [平权 §2](./human-agent-operational-parity-review.md) |

---

<details>
<summary>附录：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API | `src/public/parts/shells/chat/public/llms.txt` |
| Hub / Session | `hub/AGENTS.md`；`session/AGENTS.md` |
| 草稿 / 离线 / 投递 | `hub/composerDraft.mjs`；`hub/sendQueue.mjs`；`hub/messages/messageSend.mjs` |
| 语音 | `hub/composerFiles.mjs` `toggleVoiceRecording` |
| 引用预览 | `hub/messages/render/blocks.mjs`；`channelMessageStore.mjs`（raw `batch-get`） |
| 投递角标 / 已读 | `hub/memberReadMarkers.mjs`；`messages/render/index.mjs` `renderDeliveryStatusHtml` |
| 通话 / 屏幕共享 | `hub/call.mjs`；`hub/codecsAv.mjs`；`ws/avRelay.mjs` |
| 入群 QR | `public/src/inviteQr.mjs`（≠ link-device） |
| inbox | `lib/inbox.mjs`；`hub/inboxView.mjs` |
| plugin 本机 | `session/localPlugins.mjs` |

</details>
