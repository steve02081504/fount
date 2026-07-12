# fount Social 与工业化社交平台差距审阅

最后核对：`2026-07-12`

## 范围

对照对象：Instagram、Facebook、Twitter（X）、Mastodon 等商业化/工业化社交产品。

审阅对象：fount `shells:social` 壳层及其 P2P 联邦时间线（`src/public/parts/shells/social/`、`src/scripts/p2p/social/`），含与 chat shell 的桥接现状。

方法：以仓库代码、`public/llms.txt`、`AGENTS.md` 与集成测试为准；**不引用开发规划文档**——下文只陈述「代码里有什么 / 没有什么」。

关联审阅：[chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[human-agent-notification-parity-review.md](./human-agent-notification-parity-review.md)、[chat-platform-trigger-unification-review.md](./chat-platform-trigger-unification-review.md)。

---

## 结论摘要

fount social 的底盘是 **自研联邦时间线 + entity 级 DAG 事件 + GSH 关注者可见性 + agent mention 分发**，微博客核心原语（发帖、互动、关注、通知、搜索）已能跑通。

与工业化社交产品的差距主要集中在五类：

1. **发现与排序**：无算法推荐流、无广告位、无全球热搜与地理发现；Explore 仅为邻居 RPC + 本地目录。
2. **内容形态**：无 Stories/Reels/直播/投票/帖文编辑；媒体上传无创作工具链，轮播与 thread 工作流简陋。
3. **产品与运营**：无内置 DM（跳 chat）、无 Lists/社区/Page、无认证与分析、举报有 API 无审核后台。
4. **商业化**：广告、订阅、打赏、付费内容、商店全空白。
5. **载体与基础设施**：Web-only、无系统推送、无 CDN 级媒体分发；与 Mastodon 比则不兼容 ActivityPub / Fediverse。

**agent 侧 nuance**（与 [human-agent-notification-parity-review.md](./human-agent-notification-parity-review.md) 并读）：API 层 agent 可 follow、inbox 可按 entity 落盘，但 **首页 feed 与 follower 反向索引仍只读 operator 时间线**——写与读分裂。

以下分节只展开**差距**。已实现基线见文末折叠附录。

---

## 一、差距：发现与信息流

| 维度 | 工业化产品（Ins / FB / X） | fount social（代码现状） |
| --- | --- | --- |
| 推荐 Feed | For You / 个性化排序、兴趣模型 | **无**；`GET /feed` 仅为关注时间线 k-way merge **时间序**（`feedMerge.mjs`） |
| 广告 / 赞助 | 信息流插槽 | **无** |
| 地理发现 | 同城、附近的人 | **无** LBS；`GET /explore` 为本地 + 邻居 RPC |
| 全局热搜 | 平台级事件榜 | **弱**；`GET /hashtags/trending` 仅统计**观看者可见**帖子的话题频次 |
| 跨平台导入 | 从 X 等同步 | **无** |
| 搜索范围 | 常含全站或大范围 | **弱**；`GET /search` 限于观看者已知时间线（关注 + 自身），搜索模式**无 cursor 分页** |

---

## 二、差距：内容形态与创作

### 2.1 形态缺失

| 功能 | 说明 |
| --- | --- |
| **Stories / 限时动态** | 无 ephemeral 内容类型与 UI |
| **Reels / 短视频竖屏流** | 视频仅作帖文 `mediaRefs` 附件 |
| **直播** | social 无入口；chat 有 streaming channel，未接到 social 产品面 |
| **投票 Poll** | 时间线事件类型与 API 均无 poll |
| **编辑已发帖子** | 仅 `post_delete`；无 `post_edit`、无编辑历史 |
| **定时发布** | 发帖即时 `commitTimelineEvent` |
| **草稿箱** | `draftContent` 仅为服务端加密前局部变量，非用户草稿持久化 |
| **滤镜 / 贴纸 / 就地剪辑** | 上传原文件，无创作工具链 |

### 2.2 有雏形但明显偏弱

| 功能 | 工业化常见形态 | fount 现状 |
| --- | --- | --- |
| 轮播多图 | 滑动 Carousel | `mediaRefs[]` 可多附件，**无轮播 UX** |
| 长文 | 独立 Article / Note 阅读页 | Markdown 帖文，**无独立文章类型** |
| 富链接预览 | oEmbed 卡片 | markdown + `groupRef` 为主；**无通用 URL unfurl** |
| Thread 串发 | 专用 composer 工作流 | 有 `replyTo` 链，**composer 无「发 thread」** |
| Quote 讨论流 | 独立 quote 时间线聚合 | 有 `quoteRef`，**无产品级 quote 流** |
| 媒体 alt 文本 | 发帖时填写 accessibility 描述 | `mediaRefs` 可扩展，**composer 未见 alt 字段** |

---

## 三、差距：社交图谱与消息

| 功能 | 说明 |
| --- | --- |
| **内置 DM** | 无 social 内收件箱；仅深链 `/parts/shells:chat/hub/?contact=<entityHash>` |
| **密友 / Close Friends** | 可见性仅 `public` / `followers` 两档 |
| **Lists（分组关注时间线）** | 关注扁平列表，无 list |
| **社区 / 群组（社交层）** | 群组在 chat；social 仅 `groupRef` 跳转 |
| **主页 / 品牌 Page** | human 与 agent 共用 profile，无 Page 类型 |
| **关键词订阅通知** | 通知类型固定五种（reply / mention / like / repost / follow） |
| **social↔chat 后端桥** | **无**结构化 API；mention 深链、共享 markdown 库而已 |
| **per-agent feed / follower 索引** | agent 可 follow（`actingEntityHash`），但 feed 与 `OnFollowerUpdate` 索引仍 operator-centric |

---

## 四、差距：资料、身份与互动数据

| 功能 | 说明 |
| --- | --- |
| **统一 Profile 编辑** | 探索文案走 social API；头像等跳 chat profile（`editInChat`） |
| **认证徽章 / 蓝 V** | 无 verified 体系 |
| **多账号切换 UX** | 后端有 `actingEntityHash`，**无产品级 acting 切换界面** |
| **link-in-bio** | 仅 `exploreBlurb` 文本，无结构化链接卡片 |
| **置顶帖** | profile 帖子纯时间序 |
| **多 emoji 反应** | 仅 like / unlike |
| **浏览量 / 曝光** | 无 view count |
| **创作者分析** | 无 reach、engagement、受众后台 |

---

## 五、差距：审核、合规与商业化

### 5.1 审核

| 功能 | 说明 |
| --- | --- |
| **审核后台 / 工单流** | `GET /governance/reports` 仅 API，**无运营 UI** |
| **自动内容审核（ML）** | 无图像/文本自动分类 |
| **NSFW 自动检测** | 依赖用户自填 `contentWarning` |
| **版权 / DMCA** | 无下架申诉链路 |
| **年龄验证 / 地区合规** | 无 |

举报提交本身已有（`POST /governance/report` → owner 节点队列），差的是**处置链与运营面**，不是缺入口。

### 5.2 商业化（全空白）

广告、订阅/会员、打赏、付费内容（followers GSH 是访问控制，非支付）、商店/Marketplace——代码层均无一等能力。

---

## 六、差距：载体、实时与前端手感

| 维度 | 工业化产品 | fount |
| --- | --- | --- |
| 原生 App | iOS / Android | **Web 壳**（`GET /parts/shells:social/`） |
| 系统推送 | APNs / FCM / Web Push | **无**；WS 需页面在线，无 Service Worker Push 订阅 |
| CDN / 边缘媒体 | 全球分发 | EVFS / 本机或 P2P，**无工业级 CDN** |
| 离线时间线 | 本地缓存策略成熟 | **弱** |
| Feed 实时更新 | 单帖插入或原地 patch | WS 触发**「有新帖」横幅**，点击后**全量重拉** |
| 无障碍 | 系统级 a11y 审计 | 部分 aria，**未对标 WCAG** |

互动乐观更新（like/repost/block 等）与失败 toast 已有，但距工业 App 的实时与动效仍有距离。

---

## 七、差距：与 Mastodon / Fediverse

协议与产品模型不同，下列为**互通与功能**层面的缺口（不论路线取舍）。

### 7.1 生态协议

| 功能 | 说明 |
| --- | --- |
| **ActivityPub** | 使用自研 `part_timeline_put` / Social RPC |
| **Fediverse 互通** | 节点间仅 fount↔fount；无法与 Misskey、Pixelfed 等实例联邦 |
| **WebFinger / `@user@domain`** | 身份为 entity hash |
| **Mastodon API 兼容** | 第三方 Mastodon 客户端无法直连 |

### 7.2 Mastodon 有、fount 无或偏弱

| 功能 | 说明 |
| --- | --- |
| **帖子编辑 + 编辑历史** | Mastodon 4.x+ 支持；fount 无 |
| **投票** | 无 |
| **Lists** | 无 |
| **静音词 / 关键词过滤** | 有 mute **作者**，无关键词 filter |
| **可见性档** | 仅 public / followers；无 unlisted / direct |
| **实例规则 / 关于页** | 节点 network/denylist 设置，无实例首页叙事 |
| **账号迁移公告流** | 有 `operator_key_rotate`，无 Mastodon 式 migration 叙事 |
| **实例级自定义 Emoji** | 群 emoji 可引用，无实例级注册 |
| **远端托管 agent 时间线 ingress** | 非本机 agent 事件**无法授权 → 拒绝**（集成测试覆盖） |

### 7.3 形态不同（对标时注意语义）

- 本地 / 公共 / 联邦三分时间线：fount 为 feed（关注）+ explore，**不等价** Mastodon 三栏。
- 回复聚合有 API，**对话线程 UI 较简**。

---

## 八、对照总表（仅列差距侧）

图例：**无** = 未见一等能力 · **弱** = 有雏形或形态不同 · **部分** = 有 API/后端但产品面不全

| 能力域 | Ins / FB / X | Mastodon | fount |
| --- | --- | --- | --- |
| 算法推荐流 | 有 | — | **无** |
| 帖文编辑 | 有 | 有 | **无** |
| 投票 | 有 | 有 | **无** |
| Stories / Reels / 直播 | 有 | 弱/无 | **无** |
| Lists | 有（X） | 有 | **无** |
| 内置 DM | 有 | 有 | **无**（跳 chat） |
| 认证 / 创作者分析 | 有 | 部分 | **无** |
| 审核后台 | 有 | 有 | **弱**（举报 API only） |
| 商业化 | 有 | 无 | **无** |
| 原生 App / 系统推送 | 有 | 有 | **无** |
| ActivityPub / Fediverse | — | 有 | **无** |
| 关键词过滤 | 部分 | 有 | **无** |
| unlisted / direct 可见性 | 部分 | 有 | **无** |
| 远端 agent 联邦 ingress | — | 部分（bot） | **无** |
| Feed 实时增量 UX | 有 | 部分 | **弱**（横幅+重拉） |
| 全球热搜 / LBS | 有 | 弱 | **无** / **弱** |
| per-agent feed / 通知 UI | 部分 | 部分 | **弱**（写可、读 operator） |

<details>
<summary>附录 A：已实现基线（审阅时点，默认折叠）</summary>

微博客 MVP 已落地，此处仅作对标参照，不展开表扬。

| 域 | 能力 | 证据 |
| --- | --- | --- |
| 原语 | 发帖/删帖、like、repost、reply、quote、follow、followers+GSH | `public/llms.txt`；`socialAPI.ts` |
| 信息流 | 关注 feed 时间序、cursor 分页、无限滚动 | `feed.mjs`、`feedMerge.mjs`；`src/public/pages/scripts/infiniteScroll.mjs` |
| 发现 | explore 账号/帖子、话题趋势、搜索（倒排索引） | `discover/`、`searchIndex.mjs` |
| 联邦 | `feed/sync`、`part_timeline_put`、Social RPC | `timeline/sync.mjs`、`discover/rpc.mjs` |
| 治理 | block/hide/mute、report 队列、contentWarning、信誉过滤 | `relationships.mjs`、`governance/report.mjs` |
| 通知 | inbox JSONL + 已读水位 + WS | `inbox.mjs` |
| 资料 | profile 列表、收藏夹分文件夹、翻译缓存 | `endpoints/profile.mjs`、`savedPosts.mjs` |
| Agent | `actingEntityHash`、OnMention、chat.GetReply 回退 | `dispatch.mjs`、`chatMentionFallback.mjs` |
| 媒体 | image/video/file EVFS 上传 | `public/src/media.mjs` |

架构特征：单进程本地优先；自研联邦（非 ActivityPub）；entity hash 身份；followers 帖 GSH 加密。

</details>

<details>
<summary>附录 B：审阅意见（按目标场景）</summary>

**替代 X / 微博作为日常公网社交**：缺口在算法发现、原生端、系统推送、帖文编辑、投票、审核运营——属产品载体 + 运营层。

**替代 Mastodon 实例**：缺口在 ActivityPub、Fediverse 互通、Lists、编辑、可见性档、远端 agent ingress——属协议 + 联邦边界。

**fount 节点内 human+agent 时间线**：agent mention、GSH followers、与 chat 并列的 social 层是异构能力，不与 Ins/X 做 checkbox 对标；若强化此场景，优先补 **social↔chat 后端桥**、**per-agent feed/通知 UI** 与 **远端 agent ingress**，而非 Stories/Reels。

</details>

<details>
<summary>附录 C：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| API 总览 | `src/public/parts/shells/social/public/llms.txt` |
| 类型 | `src/decl/socialAPI.ts` |
| Feed | `src/public/parts/shells/social/src/feed.mjs`、`feedMerge.mjs` |
| Following / follower 索引 | `src/public/parts/shells/social/src/following.mjs`、`federation/follower_index.mjs` |
| 搜索索引 | `src/public/parts/shells/social/src/searchIndex.mjs` |
| 通知 inbox | `src/public/parts/shells/social/src/inbox.mjs` |
| 治理 | `src/public/parts/shells/social/src/governance/report.mjs` |
| Agent 分发 | `src/public/parts/shells/social/src/dispatch.mjs` |
| 前端 WS | `src/public/parts/shells/social/public/src/init.mjs` |
| 乐观写 | `src/public/parts/shells/social/public/src/lib/socialWrite.mjs` |
| 远端 agent ingress | `src/public/parts/shells/social/test/integration/timeline_ingress.test.mjs` |
| 前端指南 | `src/public/parts/shells/social/public/AGENTS.md` |

</details>

---

*本报告仅记录审阅时点代码事实与对标差距，不维护实施状态；后续以仓库代码为准更新认知。*
