/**
 * OnMention 无 social handler 时回退 chat.GetReply：构造最小 chatReplyRequest 并取回复正文。
 */
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../../../chat/src/chat/session/builtinParts.mjs'

/**
 * @param {string} username replica
 * @param {string} charPartName chars 目录名
 * @param {object} char char part
 * @param {object} mentionEvent OnMention 载荷
 * @returns {Promise<string | null>} 回复正文；char 无 GetReply 或回复为空时 null
 */
export async function mentionFallbackReplyText(username, charPartName, char, mentionEvent) {
	const getReply = char.interfaces?.chat?.GetReply
	if (!getReply) return null

	const now = new Date()
	const entry = {
		name: mentionEvent.authorDisplayName || 'user',
		time_stamp: now,
		role: 'user',
		content: mentionEvent.postText || '',
		files: [],
		extension: {
			platform: 'social',
			postId: mentionEvent.postId,
			authorEntityHash: mentionEvent.authorEntityHash,
		},
	}
	const charInfo = char.info?.['zh-CN'] || char.info?.['en-US'] || {}
	const request = {
		supported_functions: {
			markdown: true,
			mathjax: false,
			html: false,
			unsafe_html: false,
			files: false,
			add_message: false,
			fount_i18nkeys: false,
			fount_assets: false,
			fount_themes: false,
		},
		chat_name: 'social:mention',
		char_id: charPartName,
		username,
		Charname: charInfo.name || charPartName,
		UserCharname: mentionEvent.authorDisplayName || 'user',
		ReplyToCharname: mentionEvent.authorDisplayName,
		locales: [{ code: mentionEvent.lang || 'zh-CN' }],
		time: now,
		world: BUILTIN_WORLD,
		user: BUILTIN_PERSONA,
		char,
		other_chars: {},
		plugins: {},
		chat_log: [entry],
		timelines: [entry],
		chat_summary: '',
		chat_scoped_char_memory: {},
		extension: {
			platform: 'social',
			mention: {
				postId: mentionEvent.postId,
				authorEntityHash: mentionEvent.authorEntityHash,
			},
		},
		/** @returns {Promise<null>} social 回退请求不支持追加消息 */
		AddChatLogEntry: async () => null,
		/** @returns {Promise<object>} 原样返回请求自身（无会话可刷新） */
		Update: async function update() { return this },
	}

	const reply = await getReply(request)
	return String(reply?.content ?? '').trim() || null
}
