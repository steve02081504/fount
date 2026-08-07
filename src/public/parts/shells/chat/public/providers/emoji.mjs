/**
 * Chat shell 表情包容器（`registries.emoji`）。
 */
import { primaryLocale, loadPreferredLangs } from '/scripts/i18n/index.mjs'
import { resolveEmojiItemLabels, resolvePackPresentation } from '/scripts/features/emoji/packPresentation.mjs'

import { CHAT_API_CLIENT_PREFIX } from '../shared/apiPaths.mjs'
import { formatEmojiToken, tokenForSelection } from '../shared/inlineTokenSyntax.mjs'
import {
	addEmojiCollectionPack,
	discoverEmojiPacks,
	getEmojiUsage,
	getGroupPreview,
	listEmojiPacks,
	recordEmojiUsage,
	removeEmojiCollectionPack,
} from '../src/endpoints/emoji.mjs'

const CHAT_API = CHAT_API_CLIENT_PREFIX

/**
 * 包表情内容 URL（经 chat API 代理）。
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} 可嵌入 img 的 URL
 */
export function packEmojiContentUrl(packId, emojiId) {
	return `${CHAT_API}/emoji-content/${encodeURIComponent(packId)}/${encodeURIComponent(emojiId)}`
}

/**
 * 拉取 usage / collection 状态。
 * @returns {Promise<object>} emoji-usage 载荷
 */
async function fetchEmojiUsage() {
	return getEmojiUsage()
}

/**
 * 拉取当前上下文可见的包列表。
 * @param {object} [context] 选择器上下文
 * @param {string} [context.groupId] 当前群 ID
 * @returns {Promise<object[]>} 原始包清单
 */
async function fetchAvailablePacks(context = {}) {
	return listEmojiPacks(context.groupId)
}

/**
 * 群默认 pack：API 已 resolve 的 defaultEmojiPackId 与 packId 对齐。
 * @param {object} pack pack 摘要
 * @returns {boolean} 是否为该群默认包
 */
function isDefaultGroupPack(pack) {
	return Boolean(pack?.packId && pack.defaultEmojiPackId === pack.packId)
}

/**
 * 解析设置面板当前编辑 pack。
 * @param {{ activeEmojiPackId?: string, state?: { groupSettings?: { defaultEmojiPackId?: string } } }} context 设置上下文
 * @param {string[]} packIds 可用 packId
 * @param {string} groupId 群 ID
 * @returns {string} 活动 packId
 */
export function resolveActivePackId(context, packIds, groupId) {
	const ids = packIds.filter(Boolean)
	let active = String(context?.activeEmojiPackId || '').trim()
	if (!active || !ids.includes(active))
		active = String(context?.state?.groupSettings?.defaultEmojiPackId || '').trim() || groupId
	if (!ids.includes(active)) active = ids[0] || groupId
	return active
}

/**
 * Chat shell 表情注册表 provider 默认导出。
 */
export default {
	kind: 'emoji',

	/**
	 * 列出当前上下文可用的 emoji 包。
	 * @param {object} [context] 选择器上下文
	 * @param {string} [context.groupId] 当前群 ID
	 * @returns {Promise<object[]>} 带展示字段与条目的包列表
	 */
	async listPacks(context = {}) {
		const locales = loadPreferredLangs().length ? loadPreferredLangs() : [primaryLocale()]
		const packs = await fetchAvailablePacks(context)
		return packs.map(pack => {
			const presentation = resolvePackPresentation(pack, locales, pack.infoDefaults || {})
			const items = (pack.items || pack.entries || []).map(entry => {
				const labels = resolveEmojiItemLabels(entry, locales)
				const packId = pack.packId
				const emojiId = entry.emojiId
				return {
					kind: 'pack',
					packId,
					emojiId,
					emojiRef: formatEmojiToken(packId, emojiId),
					name: labels.name,
					alt: labels.alt,
					label: labels.name,
					previewUrl: packEmojiContentUrl(packId, emojiId),
					animated: !!entry.animated,
				}
			})
			return {
				packId: pack.packId,
				source: pack.source || { kind: 'group', id: pack.groupId || pack.packId },
				groupId: pack.groupId,
				joinedAt: pack.joinedAt,
				defaultEmojiPackId: pack.defaultEmojiPackId,
				isDefault: isDefaultGroupPack(pack),
				localized: pack.localized,
				infoDefaults: pack.infoDefaults,
				name: presentation.name,
				avatar: presentation.avatar,
				items,
			}
		})
	},

	packContentUrl: packEmojiContentUrl,

	/**
	 * 解析包来源（群）的预览信息。
	 * @param {object} pack 包对象
	 * @returns {Promise<object | null>} 群预览载荷；无群来源为 null
	 */
	async packSourcePreview(pack) {
		const groupId = pack?.source?.kind === 'group' ? pack.source.id : pack?.groupId
		if (!groupId) return null
		try {
			const preview = await getGroupPreview(groupId)
			return { kind: 'group', groupId, pack, preview }
		}
		catch {
			return { kind: 'group', groupId, pack }
		}
	},

	/**
	 * 发现可加入的公开群表情包。
	 * @param {{ limit?: number }} [options] 发现选项
	 * @returns {Promise<object[]>} 公开群包 offers
	 */
	async discoverPacks(options = {}) {
		const locales = loadPreferredLangs().length ? loadPreferredLangs() : [primaryLocale()]
		const offers = await discoverEmojiPacks(options.limit || 48)
		return offers.map(offer => {
			const presentation = resolvePackPresentation(offer, locales, offer.infoDefaults || {})
			return {
				packId: offer.packId,
				source: { kind: 'group', id: offer.sourceId },
				groupId: offer.sourceId,
				localized: offer.localized,
				infoDefaults: offer.infoDefaults,
				itemCount: offer.itemCount,
				joinPolicy: offer.joinPolicy,
				name: presentation.name,
				avatar: presentation.avatar,
				description: presentation.description,
				tags: presentation.tags,
				links: presentation.links,
			}
		})
	},

	usage: {
		/**
		 * 加载 emoji 使用记录。
		 * @returns {Promise<{ log: object[], lastUsedAtByPack: object }>} 最近使用日志与包级时间戳
		 */
		async load() {
			const state = await fetchEmojiUsage()
			return { log: state.log || [], lastUsedAtByPack: state.lastUsedAtByPack || {} }
		},
		/**
		 * 记录一次 emoji 使用。
		 * @param {object} item Unicode 或 pack 选中项
		 * @returns {Promise<void>}
		 */
		async record(item) {
			await recordEmojiUsage(item)
		},
	},

	collection: {
		/**
		 * 列出用户收藏的包与表情。
		 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 用户收藏的包与表情
		 */
		async list() {
			const state = await fetchEmojiUsage()
			return state.collection || { packIds: [], emojiIds: [] }
		},
		/**
		 * 将包加入收藏。
		 * @param {string} packId 包 ID
		 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 更新后收藏
		 */
		async add(packId) {
			return addEmojiCollectionPack(packId)
		},
		/**
		 * 从收藏移除包。
		 * @param {string} packId 包 ID
		 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 更新后收藏
		 */
		async remove(packId) {
			return removeEmojiCollectionPack(packId)
		},
	},

	tokenForSelection,

	/**
	 * 判断条目是否为群/包自定义表情。
	 * @param {object} item picker 或消息条目
	 * @returns {boolean} 含 packId 与 emojiId 时为 true
	 */
	isGroupEmojiItem(item) {
		return !!item?.packId && !!item?.emojiId
	},
}
