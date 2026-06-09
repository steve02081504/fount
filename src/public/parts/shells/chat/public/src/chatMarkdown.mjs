/**
 * 【文件】public/src/chatMarkdown.mjs
 * 【职责】聊天 Markdown 预处理：自定义表情 token、频道链接占位、缓存 emoji data URL。
 * 【原理】expandInlineEmojiTokens 将 :[group/emoji]: 转为图片语法；preprocessChatMarkdown 串联展开与 resolveEmojiUrl。
 * 【数据结构】EMOJI_TOKEN 正则；putCachedEmojiDataUrl 内存缓存 Map。
 * 【关联】chatMarkdownConvertor.mjs、expandChannelLinks.mjs、customEmojis。
 */
const EMOJI_TOKEN = /:\[([\w.-]+)\/([\w.-]+)]:/g

/**
 * 将 `:[groupId/emojiId]:` 转为可经普通 Markdown 处理的占位（图片语法）。
 * @param {string} text 原始 Markdown 文本
 * @param {(groupId: string, emojiId: string) => Promise<string | null>} [resolveEmojiUrl] 返回图片 URL 或 null
 * @returns {Promise<string>} 替换表情占位后的文本
 */
export async function expandInlineEmojiTokens(text, resolveEmojiUrl) {
	if (!resolveEmojiUrl)
		return text.replace(EMOJI_TOKEN, (match, groupId, emojiId) => {
			void match
			return `![emoji](about:blank#fount-emoji:${encodeURIComponent(groupId)}/${encodeURIComponent(emojiId)})`
		})
	let out = text
	for (const match of [...text.matchAll(EMOJI_TOKEN)]) {
		const url = await resolveEmojiUrl(match[1], match[2]).catch(() => null)
		const src = url || `about:blank#fount-emoji:${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`
		out = out.split(match[0]).join(`![emoji](${src})`)
	}
	return out
}

/**
 * 将 `#[groupId/channelId]` 与 `#[groupId]` 转为 Markdown 链接（非 unified 管线场景复用）。
 * @param {string} text 原始文本
 * @returns {string} 展开群/频道链接后的文本
 */
export { expandChannelLinksInText } from './lib/expandChannelLinks.mjs'

/**
 * 聊天消息 Markdown 预处理（表情 URL 展开）。
 * @param {string} markdown 原始 Markdown
 * @param {{ resolveEmojiUrl?: (groupId: string, emojiId: string) => Promise<string | null> }} [opts] 选项
 * @returns {Promise<string>} 预处理后的 Markdown 字符串
 */
export async function preprocessChatMarkdown(markdown, opts = {}) {
	let text = String(markdown ?? '')
	text = await expandInlineEmojiTokens(text, opts.resolveEmojiUrl)
	return text
}

/**
 * IndexedDB 表情占位缓存键 `groupId/emojiId` → data URL 或 https URL。
 */
const EMOJI_DB = 'fount_chat_emoji_cache'
const EMOJI_STORE = 'emojis'
const EMOJI_VER = 1

/**
 * @returns {Promise<IDBDatabase>} 打开后的 IndexedDB 连接
 */
function openEmojiDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(EMOJI_DB, EMOJI_VER)
		/** @returns {void} */
		request.onerror = () => reject(request.error)
		/** @returns {void} */
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(EMOJI_STORE))
				database.createObjectStore(EMOJI_STORE, { keyPath: 'k' })
		}
		/** @returns {void} */
		request.onsuccess = () => resolve(request.result)
	})
}

/**
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} data URL 或 https URL；未命中时为 null
 */
export async function getCachedEmojiDataUrl(groupId, emojiId) {
	try {
		const database = await openEmojiDb()
		const cacheKey = `${groupId}/${emojiId}`
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_STORE, 'readonly')
			const query = transaction.objectStore(EMOJI_STORE).get(cacheKey)
			/** @returns {void} */
			query.onsuccess = () => resolve(query.result?.v || null)
			/** @returns {void} */
			query.onerror = () => reject(query.error)
		})
	}
	catch {
		return null
	}
}

/** @type {((groupId: string, emojiId: string) => Promise<string | null>) | null} */
let emojiUrlResolver = null

/**
 * 注册自定义表情 URL 解析（Hub 初始化时注入本地表情列表等）。
 * @param {(groupId: string, emojiId: string) => Promise<string | null>} resolveEmojiUrl 按群/表情 ID 解析图片 URL
 * @returns {void}
 */
export function setEmojiUrlResolver(resolveEmojiUrl) {
	emojiUrlResolver = resolveEmojiUrl
}

/**
 * 解析表情 URL：先本地缓存，再可选已注册的 `emojiUrlResolver`。
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} 可用图片 URL，失败或未配置时为 null
 */
export async function resolveEmojiUrlBestEffort(groupId, emojiId) {
	const cached = await getCachedEmojiDataUrl(groupId, emojiId)
	if (cached) return cached
	if (emojiUrlResolver) {
		const fromResolver = await emojiUrlResolver(groupId, emojiId).catch(() => null)
		if (fromResolver) {
			await putCachedEmojiDataUrl(groupId, emojiId, fromResolver).catch(() => {})
			return fromResolver
		}
	}
	const { fetchGroupEmojiDataUrl } = await import('./groupEmojiApi.mjs')
	const fromApi = await fetchGroupEmojiDataUrl(groupId, emojiId).catch(() => null)
	if (fromApi) await putCachedEmojiDataUrl(groupId, emojiId, fromApi).catch(() => {})
	return fromApi
}

/**
 * 写入 IndexedDB 表情缓存。
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @param {string} dataUrlOrUrl data URL 或 https URL
 * @returns {Promise<void>} 写入完成
 */
export async function putCachedEmojiDataUrl(groupId, emojiId, dataUrlOrUrl) {
	const database = await openEmojiDb()
	const cacheKey = `${groupId}/${emojiId}`
	await new Promise((resolve, reject) => {
		const transaction = database.transaction(EMOJI_STORE, 'readwrite')
		transaction.objectStore(EMOJI_STORE).put({ k: cacheKey, v: dataUrlOrUrl })
		/** @returns {void} */
		transaction.oncomplete = () => resolve()
		/** @returns {void} */
		transaction.onerror = () => reject(transaction.error)
	})
}
