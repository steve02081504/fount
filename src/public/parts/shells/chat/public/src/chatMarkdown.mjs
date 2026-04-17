/**
 * Chat Markdown：在标准 Markdown 之前做方言预处理（表情占位、群/频道链接）。
 * 不信任来源时剥离危险标签片段。
 */

const EMOJI_TOKEN = /:\[([\w.-]+)\/([\w.-]+)\]:/g
const CHANNEL_LINK = /#\[([\w.-]+)\/([\w.-]+)\]/g
const GROUP_LINK = /#\[([\w.-]+)\](?!\/)/g

/**
 * @param {string} html 可能含危险片段的 HTML 字符串
 * @returns {string} 剥离 script/style 与内联事件后的字符串
 */
function stripUntrustedDangerous(html) {
	return String(html)
		.replace(/<script\b[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?>[\s\S]*?<\/style>/gi, '')
		.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/**
 * 将 `:[groupId/emojiId]:` 转为可经普通 Markdown 处理的占位（图片语法）。
 * @param {string} text 原始 Markdown 文本
 * @param {(groupId: string, emojiId: string) => Promise<string | null>} [resolveEmojiUrl] 返回图片 URL 或 null
 * @returns {Promise<string>} 替换表情占位后的文本
 */
export async function expandInlineEmojiTokens(text, resolveEmojiUrl) {
	if (!resolveEmojiUrl)
		return text.replace(EMOJI_TOKEN, (_m, g, e) =>
			`![emoji](about:blank#fount-emoji:${encodeURIComponent(g)}/${encodeURIComponent(e)})`)
	let out = text
	for (const m of [...text.matchAll(EMOJI_TOKEN)]) {
		const url = await resolveEmojiUrl(m[1], m[2]).catch(() => null)
		const src = url || `about:blank#fount-emoji:${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
		out = out.split(m[0]).join(`![emoji](${src})`)
	}
	return out
}

/**
 * 将 `#[groupId/channelId]` 与 `#[groupId]` 转为 Markdown 链接。
 * @param {string} text 原始文本
 * @returns {string} 展开群/频道链接后的文本
 */
export function expandInlineChannelLinks(text) {
	let s = text.replace(CHANNEL_LINK, (_m, gid, cid) =>
		`[#${gid}/${cid}](/parts/shells:chat/#${encodeURIComponent(gid)}:${encodeURIComponent(cid)})`)
	s = s.replace(GROUP_LINK, (_m, gid) =>
		`[#${gid}](/parts/shells:chat/#${encodeURIComponent(gid)})`)
	return s
}

/**
 * 完整预处理：表情 + 链接 + 不信任时剥离内联 HTML 风险。
 * @param {string} markdown 原始 Markdown
 * @param {{ trusted?: boolean, resolveEmojiUrl?: (g: string, e: string) => Promise<string | null> }} opts 选项
 * @returns {Promise<string>} 预处理后的 Markdown 字符串
 */
export async function preprocessChatMarkdown(markdown, opts = {}) {
	let s = String(markdown ?? '')
	s = expandInlineChannelLinks(s)
	s = await expandInlineEmojiTokens(s, opts.resolveEmojiUrl)
	if (!opts.trusted)
		s = stripUntrustedDangerous(s)
	return s
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
		const r = indexedDB.open(EMOJI_DB, EMOJI_VER)
		/**
		 * @returns {void}
		 */
		r.onerror = () => reject(r.error)
		/**
		 * @returns {void}
		 */
		r.onupgradeneeded = () => {
			const db = r.result
			if (!db.objectStoreNames.contains(EMOJI_STORE))
				db.createObjectStore(EMOJI_STORE, { keyPath: 'k' })
		}
		/**
		 * @returns {void}
		 */
		r.onsuccess = () => resolve(r.result)
	})
}

/**
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} data URL 或 https URL；未命中时为 null
 */
export async function getCachedEmojiDataUrl(groupId, emojiId) {
	try {
		const db = await openEmojiDb()
		const k = `${groupId}/${emojiId}`
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(EMOJI_STORE, 'readonly')
			const q = tx.objectStore(EMOJI_STORE).get(k)
			/**
			 * @returns {void}
			 */
			q.onsuccess = () => resolve(q.result?.v || null)
			/**
			 * @returns {void}
			 */
			q.onerror = () => reject(q.error)
		})
	}
	catch {
		return null
	}
}

/**
 * 解析表情 URL：先本地缓存，再可选 `globalThis.__fountResolveEmojiUrl__(groupId, emojiId)`（联邦/P2P 注入）。
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} 可用图片 URL，失败或未配置时为 null
 */
export async function resolveEmojiUrlBestEffort(groupId, emojiId) {
	const cached = await getCachedEmojiDataUrl(groupId, emojiId)
	if (cached) return cached
	const hook = typeof globalThis !== 'undefined' && globalThis.__fountResolveEmojiUrl__
	if (typeof hook === 'function')
		return hook(groupId, emojiId).catch(() => null)
	return null
}

/**
 * 写入 IndexedDB 表情缓存。
 * @param {string} groupId 群组 ID
 * @param {string} emojiId 表情 ID
 * @param {string} dataUrlOrUrl data URL 或 https URL
 * @returns {Promise<void>} 写入完成
 */
export async function putCachedEmojiDataUrl(groupId, emojiId, dataUrlOrUrl) {
	const db = await openEmojiDb()
	const k = `${groupId}/${emojiId}`
	await new Promise((resolve, reject) => {
		const tx = db.transaction(EMOJI_STORE, 'readwrite')
		tx.objectStore(EMOJI_STORE).put({ k, v: dataUrlOrUrl })
		/**
		 * @returns {void}
		 */
		tx.oncomplete = () => resolve()
		/**
		 * @returns {void}
		 */
		tx.onerror = () => reject(tx.error)
	})
}
