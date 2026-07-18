# fount Social 与工业化社交平台差距审阅

最后核对：`2026-07-18`（对照仓库代码；已落地能力不复述，只列差距）

## 范围

对照：Instagram、Facebook、Twitter（X）、Mastodon。对象：`shells:social` + 自研联邦时间线（壳内 `timeline/`、`discover/`、`federation/`），含与 chat 的桥接。

方法：以代码、`public/llms.txt`、`AGENTS.md` 与集成测试为准；**不引用开发规划文档**（平权/未排期方向见关联档，不在此开里程碑）。

关联：[chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)。

图例：**无** = 未见一等能力 · **弱** = 有雏形或形态不同 · **部分** = 有 API/后端但产品面不全。

---

## 结论摘要

微博客主路径（发帖互动、关注、通知、搜索、投票、编辑、Community Notes、关键词屏蔽、媒体 alt/CW、`for_you`+dwell、话题订阅、短视频流、直播、`replyPolicy`/精选评论、定时入队、可见性档 + 相册、per-entity 草稿箱、dislike）已齐。与工业化社交的残差集中在六类：

1. **发现与排序**：启发式 `for_you`；无全局 ML、无广告、无 LBS；热搜为本地 + 邻居聚合（非全球）；帖文搜索限于已知时间线 + 邻居 `post_search`。
2. **内容形态**：无 Stories/Highlights；无 Spaces（纯音频房）；无滤镜贴纸库 / 独立 Article；thread / quote 产品工作流简陋；富链接仅前端水合；定时帖有 API 无队列管理 UI。
3. **产品与图谱**：无内置 DM（跳 chat）；可见性档已齐但无独立密友列表产品；无 Lists/社区/Page；无认证与创作者分析；无置顶帖；**无举报工单**（本机 mute/block/hide/denylist 自理）。
4. **安全与反垃圾**：**无人帖 rate-limit / CAPTCHA / 新号限制**；无 NSFW 自动检测、无作者按时长 mute。
5. **商业化 / 合规**：广告/订阅/打赏/付费/商店空白；无 GDPR/Archive 导出、无社交删号打包、无跨平台导入。
6. **载体与协议**：Web-only；Web Push 有、APNs/FCM 无；无 CDN 级媒体；不兼容 ActivityPub；**远端托管 agent 运营写路径未对称**（ingress 引导 + 本机 owner 改删已通；跨节点写仍断）。

---

## 一、发现与信息流

| 维度 | 工业化产品 | fount |
| --- | --- | --- |
| 推荐 Feed | For You / ML | **部分**：`for_you` + taste + 本地 dwell；无 ML。薄首页可联邦 `backfill`；游标耗尽可 replay |
| 广告 / 赞助 | 信息流插槽 | **无** |
| 地理发现 | 同城、附近 | **无** LBS（`nearby` = 邻居节点 `part_query`，非坐标） |
| 全局热搜 | 平台级榜 | **部分**：本地频次 + `scope=nearby` 邻居聚合 |
| 跨平台导入 | 从 X 等同步 | **无** |
| 搜索范围 | 常含全站 | **部分**：已知时间线 + 邻居 `post_search` |

话题订阅（`tag_follow`）、`replyPolicy` / 精选评论（`reply_feature` / `featured_only`）——**已齐，勿当缺口**。

---

## 二、内容形态与创作

| 功能 | 现状 vs 目标 |
| --- | --- |
| **Stories / 限时动态** | **无** ephemeral 类型与 UI；目标若做需独立事件类型 + TTL 折叠，与永久帖时间线分轨 |
| **Highlights** | **无** |
| **Spaces / 纯音频房** | social 直播（`/live/*` + av-relay，含双主播）有；**无** Twitter Spaces 式纯音频房（无视频轨、无单独 lobby UX） |
| **草稿箱** | **已齐**：per-entity `drafts.json` + `GET\|POST\|DELETE /drafts*` + `#drafts` UI；对照 chat Hub `composerDraft.mjs`（localStorage 频道草稿）形态不同——social 是多草稿服务端草稿箱 |
| **定时发布** | **部分**：composer `publishAt` + `scheduledPostWatcher` + `GET\|DELETE /posts/scheduled` 已通；**无**定时队列管理界面（无 `#scheduled` view） |
| **滤镜 / 贴纸创作库** | 发图前有裁剪/打码/画笔；无滤镜贴纸库 |
| **Collections（策展合集）** | 收藏夹 folders（`saved-posts*`）= 私有整理；≠ 对外策展集合 / 可分享清单。相册 = 帖链接合集（见 §3.1），也不是 Collections |
| **长文 Article** | Markdown 帖文，无独立文章类型 / 阅读页 |
| **富链接预览** | 前端裸链水合；非 oEmbed 入库 |
| **Thread 串发 UX** | 有 `replyTo` 链 + 同页 `feedThreads` 合并；composer **无**「一次发多帖 thread」工作流 |
| **Quote 讨论流** | 有 `quoteRef` + composer `quotePreview` + 帖卡引用块；**无**「被引用」聚合时间线 / 产品级 quote 页（无 `quotedBy` 索引） |

短视频竖屏流（`GET /videos/feed` + replay）、直播（弹幕/av-relay）——**已齐，勿当缺口**。

---

## 三、社交图谱与消息

| 功能 | 说明 |
| --- | --- |
| **内置 DM** | 无 social 收件箱；深链 chat Hub `?contact=`（`formatChatDmFromSocial`） |
| **密友 / Close Friends** | 可见性已扩展（见 §3.1）；无独立「密友列表」产品类型（`selected` 每次手填 allow 列表） |
| **Lists** | 关注扁平列表，无 list 时间线 |
| **社区 / 群组（社交层）** | 群组在 chat；social 仅 `groupRef` 跳转 |
| **主页 / 品牌 Page** | 无 Page 类型 |
| **关键词订阅通知** | 本地屏蔽词有（可 `expiresAt`）；**无** match→提醒 |
| **真正多账号登录** | human/agent 独立实体 ≠ 多用户/多站点切换 |
| **social↔chat 结构化桥** | 深链 + `OnMessage` / `replyViaChat`；**无** mention→channel ingress、chat→social 草稿确认流。chat 内 `@mention` inbox ≠ 本项 |

### 3.1 可见性与相册

| 面 | 代码语义 | 备注 |
| --- | --- | --- |
| `content.visibility` | `public` / `unlisted` / `followers` / `followers_since` / `selected` / `private`；可选 `except` | `followers*` GSH；`selected`/`private` 用 pkw 按接收者包裹；`except` 仅过滤层（`visibilitySpec.mjs`） |
| UI 预设 | `followers_7d` / `followers_30d` → `followers_since` + `minFollowMs` | 不是独立档位，入库后是 `followers_since` |
| `unlisted` | 可读但不进探索/热搜/搜索联邦 | 对标 Mastodon unlisted |
| `post_visibility_set` | 可改密级（相册 reconcile）；收紧为 forward-looking | 已分发明文/密钥无法撤回 |
| 相册 | 帖子链接合集（无独立媒体存储）；帖密级 = 所属相册最公开档位；虚拟 `default` 不参与派生；profile Tab + composer 选册 + 帖卡 chip | feed item 带 `albums[]`（按观看者过滤） |
| `socialMeta.hideFromDiscovery` | 探索与联邦导出隐藏 | 不是帖级可见性；设置在 Social `#settings` |
| `follow_approve` | 为关注者签发 GSH vault H | **不是** locked-account 审批队列 |

### 3.2 通知类型

已有九种：`reply` / `mention` / `like` / `repost` / `follow` / `care_post` / `poll_closed` / `post_note` / `live_started`。

仍缺：关键词提醒、生日/活动、精华 digest、安全登录提醒等运营向类型。WS 推送按 login（见平权审阅 §4），非 per-entity。

---

## 四、资料、身份与互动数据

| 功能 | 说明 |
| --- | --- |
| **统一 Profile 编辑** | 「编辑资料」整页跳 chat `/parts/shells:chat/profile/`；Social 仅保留 `socialMeta`（如 `hideFromDiscovery`）在 `#settings`。无 social 内嵌完整资料编辑器。资料页有 Cabinet 页签（跨壳展示文件柜） |
| **认证徽章 / 蓝 V** | 无 |
| **link-in-bio** | 资料链接走 chat profile `localized[].links`；无独立 link-in-bio 落地页 |
| **置顶帖** | profile 帖纯时间序；无 pin（`pinAlias` 仅为搜索别名） |
| **多 emoji 反应** | 仅 like / dislike 互斥对（`reaction_index`；dislike 已进 `for_you` 打分） |
| **浏览量 / 曝光** | 无帖文 view count；dwell 只服务本地 `for_you`，不展示。直播场次有 `viewer_count` WS，≠ 创作者分析 |
| **创作者分析** | 无 reach / engagement 后台 |
| **收藏夹产品化宽度** | per-entity CRUD + folders 已有；缺分享收藏夹、协作清单 |

---

## 五、审核、反垃圾、合规与商业化

### 5.1 审核

| 功能 | 说明 |
| --- | --- |
| **审核后台 / 工单** | **无**（刻意：本机 operator 即管理员；治理靠 mute/block/hide/denylist/信誉） |
| **自动内容审核（ML）** | 无 |
| **NSFW 自动检测** | 依赖自填 CW + UI 折叠 |
| **版权 / DMCA** | 无下架申诉 |
| **年龄验证 / 地区合规** | 无 |

### 5.2 反垃圾

| 功能 | 说明 |
| --- | --- |
| **人帖 rate-limit / CAPTCHA / 新号限制** | **无**（发帖路径无人类限流；`social/src` 无对应实现） |
| **按时长 mute 作者** | **无**（mute 为布尔；屏蔽词可有 `expiresAt`） |

Agent 自动回复节流（`dispatch.mjs` `SOCIAL_THROTTLE_*`）、信誉 demote、关键词/标签屏蔽——**已有，勿当缺口**。

### 5.3 合规与账号

| 功能 | 说明 |
| --- | --- |
| **Archive / GDPR 导出** | 无 |
| **删号 / 远端擦除级联** | 无一等社交删号打包 |
| **跨平台导入** | 无 |

### 5.4 商业化

广告、订阅/会员、打赏、付费内容、商店/Marketplace——**均无**（followers GSH 是访问控制，非支付）。

---

## 六、载体、实时与前端手感

| 维度 | 工业化产品 | fount |
| --- | --- | --- |
| 原生 App | iOS / Android | **Web 壳** |
| 系统推送 | APNs / FCM / Web Push | Web Push 有；APNs/FCM **无** |
| CDN / 边缘媒体 | 全球分发 | EVFS / P2P；**无**工业 CDN |
| 离线时间线 | 成熟本地缓存 | **弱**（SW 偏站点资源；feed 仅内存预取 + replay） |
| 无障碍 | 系统级 a11y | 部分 aria；**未对标 WCAG** |

---

## 七、联邦边界与 Mastodon / Fediverse

| 缺口 | 说明 |
| --- | --- |
| **ActivityPub / Fediverse** | 自研 `part_timeline_put` / Social RPC；无法与 Misskey 等互通（产品边界「明确不做」） |
| **WebFinger / `@user@domain`** | 身份为 entity hash；可选 `handle` 非全局唯一 |
| **Mastodon API 兼容** | 第三方客户端无法直连 |
| **Lists** | 无 |
| **可见性档** | 已有 public / unlisted / followers / followers_since / selected / private（非 ActivityPub） |
| **实例规则 / 关于页** | 无实例首页叙事（仅有 network/denylist） |
| **账号迁移叙事** | 有 `operator_key_rotate`；无 Mastodon 式 migration 流 |
| **实例级自定义 Emoji** | 群 emoji 可引用；无实例级注册 |
| **远端托管 agent** | **ingress 部分**：recovery 创世链 + 活跃钥 `post` 可引导入账；陌生钥注入拒绝。**本机 owner** `post_edit`/`post_delete` 已通。**仍缺**：跨节点 owner 运营写、nodeHash→operator 链、`getSocialClient` 绑定远端 entity（403）。细节见 [平权审阅 §2](./human-agent-operational-parity-review.md) |

同步模型：pull / mailbox + 可见性过滤导出（`federationExport.mjs`）；非 AP Inbox/Outbox。三分时间线（本地/公共/联邦）与 Mastodon 三栏**不等价**。

---

## 八、对照总表（差距侧）

| 能力域 | Ins / FB / X | Mastodon | fount |
| --- | --- | --- | --- |
| 算法推荐流 | 有 | — | **部分**（启发式 `for_you` + backfill/replay） |
| Stories / Highlights / Spaces | 有 | 弱/无 | **无**（直播/短视频流已有，勿混） |
| Lists | 有 | 有 | **无** |
| 内置 DM | 有 | 有 | **无**（跳 chat） |
| 认证 / 创作者分析 | 有 | 部分 | **无** |
| 审核工单 | 有 | 有（实例） | **无**（本机自理） |
| 人帖反垃圾（限流/CAPTCHA） | 有 | 部分 | **无** |
| 商业化 | 有 | 无 | **无** |
| GDPR / Archive 导出 | 有 | 有 | **无** |
| 原生 App / 系统推送 | 有 | 有 | **部分**（Web Push；无 APNs/FCM） |
| ActivityPub / Fediverse | — | 有 | **无** |
| unlisted / direct | 部分 | 有 | **部分**（unlisted/selected/private 自研语义，非 AP） |
| 远端 agent 联邦写路径 | — | 部分（bot） | **部分**（ingress + 本机 owner 改删 ✅；跨节点写 ❌） |
| 全球热搜 / LBS | 有 | 弱 | **部分** / **无** |
| 草稿箱 | 有 | 部分 | **已有**（per-entity 服务端草稿箱） |
| 定时发布 | 有 | 部分 | **部分**（入队/watcher 有；队列 UI 无） |
| 多 emoji 反应 / 浏览量 | 有 | 部分 | **无**（仅 like/dislike） |
| 置顶帖 / Article / Collections | 有 | 部分 | **无** |

<details>
<summary>附录：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API | `src/public/parts/shells/social/public/llms.txt` |
| 类型 | `src/decl/socialAPI.ts` |
| Feed / dwell / backfill | `feed/ranking.mjs`；`engagement/dwell.mjs`；`federation/backfill.mjs` |
| 可见性 / 相册 | `lib/visibilitySpec.mjs`；`endpoints/albums.mjs`；`vault_crypto/vault.mjs` |
| 话题订阅 | `topics.mjs`；时间线 `tag_follow` |
| 短视频 / 直播 / 定时 | `endpoints/videos.mjs`；`live/`；`lib/scheduledPosts.mjs`；`GET\|DELETE /posts/scheduled` |
| 回复门控 / 精选 | `lib/replyPolicy.mjs`；`api/post.mjs` `featureReply` |
| 搜索 | `searchIndex.mjs`；`search/network.mjs` |
| 通知 | `inbox.mjs`（含 `live_started`） |
| 关键词屏蔽 | `lib/contentFilter.mjs`；`mutedKeywords.mjs` |
| Community Notes | `federation/note/index.mjs` |
| 远端 agent / owner 写 | `test/integration/timeline_ingress.test.mjs`；`federation/write_auth.mjs`；`manifest_write_auth.test.mjs` |
| 资料编辑跳转 | `public/src/actions/profileNavActions.mjs` → `/parts/shells:chat/profile/` |
| 草稿箱 | `src/drafts.mjs`；HTTP `…/drafts*`；UI `#drafts` + composer「存草稿」 |
| 平权外链 | [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) |

</details>

---

*本报告仅记录审阅时点差距；后续以仓库代码为准。*
