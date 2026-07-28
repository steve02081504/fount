# 表情包（Emoji Pack）规范

更新：`2026-07-28` · **已落地**

> 运行时以 `src/public/pages/scripts/features/emoji/`、`src/public/pages/scripts/components/emojiPicker.mjs`、chat / social 的 `providers/emoji.mjs` 为准。本文只保留**设计动机、模型语义与验收要领**。

发帖路径会把 token 内 `name`/`alt` 别名改写成规范 `emojiId`（`canonicalizeEmojiTokensInText`）；token 的 emojiId 位允许 unicode。

## 动机

原先 chat 里群表情、贴纸包、自定义收藏、使用统计各自一套；picker 按 tab 切页，且 `resolveEmojiProvider` 只取第一个 provider，social 一注册就顶掉 chat。

目标：

1. **界面与秩序归核心**，数据与分发归 part（chat / social 只是表情包提供者）。
2. 群表情与贴纸收敛为**同一 pack 模型**：一份图既可插行内 emoji，也可发大图贴纸。
3. 默认包是来源侧的**设置链接**（群 / 作者），加群或关注时自动进收藏；探索页取代脱离链接的独立安装。

## 架构

```text
核心前端：picker UI / 五档排序 / provider 聚合 / pack 展示解析 / unicode 数据 / packIndex（内容 URL + IndexedDB）
chat：群包 + usage/collection 宿主（shell data）+ 默认包链接（群设置）
social：作者包 + 关注时跨壳写收藏 + 默认包链接（实体 profile）
```

不新增框架级 HTTP API。统计与收藏住在 chat shell data，核心通过 provider **能力声明**读写；social 跨壳调 chat 接口。

排序留在前端：包内容只有 part 能给，后端若排序就得反过来认识 part。

## Pack 模型

```js
{
  packId,                       // 全局唯一
  source: { kind: 'group'|'entity', id },
  localized: { <locale>: { name, avatar, description, description_markdown,
                           version, author, home_page, issue_page,
                           tags: [], links: [{ icon, name, url }],
                           sfw_* … } },
  items: [{ emojiId,
            localized: { <locale>: { name, alt } },
            contentHash, mimeType, animated }],
}
```

- 展示字段与 `single_lang_info_t` / chat profile locale 切片同构。`infoDefaults` 传群 meta 或作者 profile presentation →「头像/名字默认取群或作者、可自定义覆盖」。
- 表情 `name`：picker tooltip + 介绍；全空回落 `emojiId`。
- 表情 `alt`：纯文字 LLM 与读屏；无则退到已解析的 `name`。
- **`isDefault` 不进包**：默认包是来源侧设置链接。

### 存储布局

| 来源 | 路径 |
| --- | --- |
| 群包 | `{groupDir}/emoji_packs/{packId}/{manifest.json,binaries/}` |
| 作者包 | `entities/{hash}/emoji_packs/`（替换原 `stickers/packs/`） |

旧 `group_emojis/manifest.json` **不读、不迁移**；老群按空处理。

## Token 语法

```text
:[emoji:packId/emojiId]:
```

- 正文 / markdown / social mediaRefs / 保存按钮统一此语法。
- 纯文字降级：token → 当前语言 `alt`（locale 取 `localesForUser` / `primaryLocale()`）。
- 反向：`alt` / `name` 可作为 `emojiId` 别名解析（**跨 locale** 建索引）；同包撞名按 manifest 顺序先到先得。
- 贴纸消息：同一 pack 图，wire 仍为 `type:'sticker'` + `emojiRef`（现为 `packId/emojiId`）或 base64；composer 单按钮——点击插 token，长按/右键发贴纸。

## Provider 契约

```js
export default {
  kind: 'emoji',
  listPacks(context),            // context: { groupId, replyToEntityHash }
  packContentUrl(packId, emojiId),
  packSourcePreview(pack),       // 可选
  discoverPacks(options),        // 可选
  usage,                         // load / record（仅 chat）
  collection,                    // list / add / remove（仅 chat）
}
```

核心 `features/emoji/providers.mjs` **聚合全部** emoji provider，不再只取第一个。

## 使用统计与收藏

chat shell data 键与 HTTP 前缀均为 **`emoji_usage`**（per fount 用户）：

```js
{ log: [{ id, at }] ≤700, lastUsedAtByPack: {}, collection: { packIds: [], emojiIds: [] } }
```

- `id`：`u:{unicode}` 或 `p:{packId}/{emojiId}`。
- 一份 700 日志同时喂「最近使用（单表情次数降序）」与「包窗口内次数」。
- `lastUsedAtByPack` 覆盖已滑出窗口的包。
- 取代昔日 512 条聚合表与 `customEmojis`（旧 API 名已废弃，不迁移）。

## 默认包链接

| 来源 | 字段 |
| --- | --- |
| 群 | `groupSettings.defaultEmojiPackId`（与 `defaultChannelId` 同位，`group_settings_update`） |
| 作者 | 实体公开 profile `defaultEmojiPackId` |

**自动收敛（幂等、惰性）**：

1. 加群 / 关注成功 → 把对应默认包写入收藏。
2. 每次拉包列表时比对「各已加入群 / 已关注作者的当前默认包」与收藏——旧默认包若在收藏里则换成新的，不在则不动（尊重手动收藏）。
3. 退群 / 取关不删收藏项，由可用性过滤挡掉。

## 可用性与可见性

- **可用** = 自有 ∪ 已加群 ∪ 已关注。
- 「加入我的收藏」以可用为前置；不可用的收藏项被过滤。
- picker **可见集** = 收藏的包 ∪ 用过的包（默认包在加群/关注时自动进收藏，故第 2 / 4 档自然成立）。

## 分类顺序（五档）

1. 最近使用 —— 700 窗口内按单个表情次数降序
2. 当前上下文的默认包 —— 当前群 / 当前正在回复的人
3. 700 窗口内用过的包 —— 窗口内次数降序
4. 其余可用来源的默认包 —— `lastUsedAtByPack` 降序，未用过的按加群 / 关注时间降序
5. Unicode 原生分组

## Picker 形态

- 包头像横向 rail + 纵向连续滚动网格 + 吸顶分区标题。
- scroll-spy（`IntersectionObserver`）同步 rail 高亮。
- 右端「跳到 Unicode」、左端「回到开头」。
- `role="toolbar"` + `aria-current`（连续滚动下 tab 语义不成立）。

## 探索页

- `part_query`：chat 出公开群包 offers，social 出作者包 offers，聚合邻居。
- 只提供「加群 / 关注」入口；**删除** `POST /stickers/install/:packId` 这类脱离链接的安装路径。
- 页面路径暂留 chat shell；入口放在 emoji picker 页脚与群设置表情页（不挂 home）。逻辑放核心共享脚本。

## 删除清单

| 删除 | 理由 |
| --- | --- |
| `registries.sticker` / `providers/sticker.mjs` / `components/stickerPicker.mjs` | 并入 emoji pack |
| `sticker_collection` shellData 与重复 `/stickers/*` 安装路径 | 可用性由链接派生 |
| 旧 512 聚合表、`customEmojis`、`emojiUsageApi` | 改为 700 日志 + collection（同名 `emoji_usage`） |
| 旧单包 `group_emojis/manifest.json` 读取 | 不迁移 |
| 独立贴纸广场 / `POST /stickers/install` | 探索页仅加群/关注 |

## Locale 匹配

前后端各自 `i18n/locale_match.mjs` 导出同名同签名：

- `matchLocale(preferred, available)` —— 严格前缀
- `getBestLocale` —— `matchLocale ?? FALLBACK_LOCALE`
- `pickLocalizedSlice(map, preferred)`

`getLocalizedInfo` / 私有 `pickLocalizedSlice` / 旧 `getbestlocale` 删除。

## 验收要领

- picker 同时展示 chat 群包与 social 作者包（多 provider 聚合）。
- 加群后默认包进收藏；作者改默认包后，旧默认若在收藏则被替换。
- token `:[emoji:packId/emojiId]:` 在 chat / social / markdown / LLM alt 降级路径一致。
- 探索页只能经加群/关注获得可用性，无独立 install。
- 旧群无 `emoji_packs/` 时 picker 不崩溃、不读旧 manifest。
