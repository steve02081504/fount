# fount Chat 与工业化 IM 差距审阅

生成时间：`2026-07-11`

## 范围

对照：Signal、Discord、Tox、QQ、微信、Line。对象：`shells:chat` + `src/scripts/p2p/`。方法：代码与 `llms.txt` 为准；不引用开发规划。

---

## 差距摘要

1. **载体与触达**：无原生客户端；无 Web Push/APNs/FCM；密码学身份无中心化恢复；联系人靠 P2P 发现/邀请码；节点离线时收信体验弱于商业 IM 的常驻代理。
2. **消息手感**：语音消息未开放；无转发/定时/阅后即焚；无单条已读回执；搜索仅群内；无跨群 inbox 检索；无 unfurl/正文翻译；线程为子频道而非内嵌 quote-reply；@mention 未形成完整通知链。
3. **规模与 AV**：单进程 av-relay + 稀疏 WebRTC 网状，无区域 SFU 集群；无消息投递 SLA。
4. **平台与运营**：无举报审核闭环、自动审核、企业 SSO/合规导出、Bot 商店；无支付/小程序生态；social↔chat 仅前端深链；persona/plugin 无正式跨节点代理。

<details>
<summary>基线清单（已实现，默认折叠）</summary>

审阅时点代码里**已有**、下文不再展开的能力，仅供对照时查阅。

| 类别 | 项 |
| --- | --- |
| 协议 | 联邦群/DM、DAG、CKG 频道加密、热/冷归档、Mailbox |
| 频道 | 文本/列表/流媒体频道、角色权限、ban/kick、反应/置顶/投票/贴纸/表情、子频道线程、fork/信誉/denylist |
| 读写 | `view-log` viewer 对称、统一写路径、persona/world 钩子、world 分布与 `WorldChatHost` |
| Hub | 未读水位+badge、群内倒排搜索、浏览器 Notification（页在后台时）、WebCodecs av-relay |
| 联邦 | 群/消息/文件 sync、`remoteWorldProxy` world RPC |

证据：`public/llms.txt`、`session/AGENTS.md`、`hub/AGENTS.md`、`src/scripts/p2p/AGENTS.md`。

</details>

---

## 一、载体与触达

| 维度 | 工业化 IM | fount |
| --- | --- | --- |
| 客户端 | iOS/Android/桌面原生 | Web Hub；需自跑 fount |
| 账号恢复 | 手机/邮箱/OAuth、云端换机 | operator 密钥；无「忘密码」中心化恢复 |
| 联系人发现 | 通讯录、扫码、推荐 | mDNS/Nostr、邀请码/深链 |
| 后台通知 | 系统推送、锁屏可达 | `hubNotifications.mjs`：仅浏览器 Notification；**无 Web Push/Service Worker** |
| 常驻收信 | 云端/手机代理 | 本机节点在线；离线靠 Mailbox |
| 云备份 | 聊天记录上云 | 本地 DAG；无托管备份产品面 |

---

## 二、消息体验

### 形态不一致（有实现，但未对齐工业 UX）

| 功能 | 工业常见 | fount |
| --- | --- | --- |
| 线程 | 主频道内 quote-reply | 独立子频道（`threadDrawer.mjs`） |
| @mention | 通知 + 未读 @ 汇总 | 主要服务 char 自动回复（`autoReply.mjs`） |
| presence | 集群级实时 | profile status + heartbeat，轻量 |
| 搜索 | 统一全局入口 | 按群 API + Hub 顶栏前端子串过滤并存（`channelSearchQuery`） |

### 缺失或偏弱

| 功能 | 说明 |
| --- | --- |
| 语音消息 | `#hub-voice-button` 仍 `disabled` |
| 转发 | 无用户级「转到另一会话」 |
| 定时发送 | 无 |
| 阅后即焚 | 无 |
| 单条已读回执 | 仅本人频道 `read-marker` seq，无 per-message receipts |
| 跨群搜索 | `searchGroupMessages` 绑定 `groupId` |
| 富链接预览 | 无 oEmbed 级 unfurl |
| 正文翻译 | 无 |
| 内联回复 | 无线程外 quote-reply 气泡 |

---

## 三、实时音视频与规模

| 维度 | 工业 IM | fount |
| --- | --- | --- |
| 媒体架构 | 区域 SFU | 单进程 `avRelay.mjs`；可嵌外部 SFU |
| 拓扑 | 媒体服务器集群 | 稀疏 WebRTC 网状，`rtcConnectionBudgetMax` 预算 |
| 规模 | 数百～数千人语音房 | 小社区量级 |
| QoS | simulcast、降噪、拥塞控制 | 基础 relay |
| 投递 | 中心化队列、SLA | DAG gossip/catchup；无 SLA |

---

## 四、安全与隐私（路线差异，非单纯落后）

| 维度 | Signal | fount |
| --- | --- | --- |
| 信任模型 | 中心化 blind relay | 联邦 DAG；参与者见拓扑/元数据 |
| 群加密 | Sender Keys 等 | CKG + DAG 签名上下文 |
| 本地存储 | 解密后仅本地 | `messages/{channelId}.jsonl` **明文侧车**；DAG 密文 |
| 元数据 | sealed sender 等 | 信任图/信誉/denylist；弱于 Signal |
| 上手 | 装 App + 手机号 | 节点/联邦/邀请码/密钥 |

相对 Tox：同属去中心化，但叠加 AI/world/DAG 治理，纯传话简洁性更差。  
相对 QQ/微信：无服务端可读审核/推荐/监管对接链。

---

## 五、治理与企业

<details>
<summary>已有治理 primitives（默认折叠）</summary>

角色权限、频道 ACL、ban/kick、审计日志、`fork`/`fork/block-opposing`、主观信誉、personal block/hide、denylist。

</details>

| 缺口 | 说明 |
| --- | --- |
| 举报→审核→处置 | 无统一 report 事件与审核 UI |
| 自动审核 | 无 |
| 企业 | 无 SSO、eDiscovery、合规导出、管理控制台 |
| Bot 生态 | parts 可编程；无 OAuth 托管与商店 |
| 商业运营层 | 无官方表情/主题商店、付费增值 |

---

## 六、超级 App 生态（QQ/微信/Line）

- 支付、小程序、公众号、游戏、直播电商——无
- 运营商短信/电话簿集成——无
- 算法推荐/官方内容运营——无
- social↔chat：**仅** `socialRunUri.mjs` / `runUri.mjs` 深链；无 mention→chat ingress、chat→social 发帖等后端桥

---

## 七、联邦对称性缺口

| 缺口 | 说明 |
| --- | --- |
| persona 跨节点 | 无正式 remote persona proxy |
| plugin 跨节点 | 联邦未对称参与 prompt 等链路 |
| 异构互通 | 无 ActivityPub 等 |

<details>
<summary>联邦已覆盖项（默认折叠）</summary>

群/消息/文件：DAG sync、Mailbox、fed_chunk、emoji CAS 等；`fed_*` live 测试矩阵。world：`remoteWorldProxy.mjs` + `rpcDispatcher.mjs`。

</details>

---

## 八、对照总表（仅列 fount 相对工业品的缺口项）

| 能力域 | fount 状态 |
| --- | --- |
| 原生移动端 | 无 |
| 系统后台推送 | 部分（浏览器 Notification only） |
| 手机号/通讯录发现 | 无 |
| 语音消息 | 无 |
| 消息转发 / 定时 / 阅后即焚 | 无 |
| 单条已读回执 | 无 |
| 跨群/全账号搜索 | 无 |
| 富链接 unfurl / 正文翻译 | 无 |
| 内嵌 quote-reply 线程 | 部分（子频道） |
| @mention 通知链 | 部分 |
| 大规模 AV / SFU | 部分 |
| 消息投递 SLA | 无 |
| 举报审核闭环 / 自动审核 | 弱/无 |
| 企业 SSO / 合规导出 | 无 |
| Bot 商店 / OAuth 托管 | 无 |
| 支付/小程序生态 | 无 |
| social↔chat 结构化桥 | 无 |
| persona/plugin 联邦对称 | 无 |
| 元数据最小化（对标 Signal） | 弱 |
| 本地明文侧车（对标 Signal） | 有（差距项） |

<details>
<summary>对照总表：fount 已对齐或异构长板（默认折叠）</summary>

| 能力域 | fount |
| --- | --- |
| 频道/权限/反应/置顶/表情 | 对齐 Discord 核心 |
| 群内全文搜索 | 部分 |
| 频道级未读水位 | 部分（无单条回执） |
| 去中心化联邦 | 有 |
| AI char/world/persona | 异构，工业 IM 无对标 |
| 可分叉治理 | 异构 |

</details>

---

## 九、按目标的优先缺口

| 目标 | 优先补 |
| --- | --- |
| 替代微信/Line | 原生客户端、系统推送、云账号恢复、联系人发现 |
| Discord 级社区 | 大规模 AV、Bot OAuth、内嵌回复 UX、全局搜索、unfurl |
| Signal 级隐私 | 元数据面、明文侧车、联邦参与者可见性 |
| 联邦 parts 完整度 | remote persona/plugin、social↔chat 后端桥 |

---

## 证据索引

| 主题 | 路径 |
| --- | --- |
| API | `src/public/parts/shells/chat/public/llms.txt` |
| Session | `src/public/parts/shells/chat/src/chat/session/AGENTS.md` |
| Hub | `src/public/parts/shells/chat/public/hub/AGENTS.md` |
| P2P | `src/scripts/p2p/AGENTS.md` |
| 搜索 | `src/public/parts/shells/chat/src/chat/search/index.mjs` |
| 未读 | `src/public/parts/shells/chat/src/chat/lib/readMarkers.mjs` |
| 通知 | `src/public/parts/shells/chat/public/hub/hubNotifications.mjs` |
| 语音按钮 | `src/public/parts/shells/chat/public/hub/index.html` |
| social 深链 | `src/public/parts/shells/chat/public/shared/socialRunUri.mjs` |

---

*审阅时点快照；以代码为准。*
