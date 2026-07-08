/**
 * OnMention 无 social handler 时回退 chat.GetReply 的最小 chatReplyRequest 构造。
 */
import { loadPart } from '../../../../../../server/parts_loader.mjs'
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../../../chat/src/chat/session/builtinParts.mjs'

/**
 * @param {string} username replica
 * @param {string} charPartName chars 目录名
 * @returns {Promise<object | null>} char part
 */
export async function loadCharForMention(username, charPartName) {
	return loadPart(username, `chars/${charPartName}`)
}

/**
 * @param {string} username replica
 * @param {string} charPartName chars 目录名
 * @param {object} char char part
 * @param {object} mentionEvent OnMention 载荷
 * @returns {object} 最小 chatReplyRequest
 */
export function buildMentionChatReplyRequest(username, charPartName, char, mentionEvent) {
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
	return {
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
		AddChatLogEntry: async () => null,
		Update: async function update() { return this },
	}
}

/**
 * @param {object} char char part
 * @param {object} request chatReplyRequest
 * @returns {Promise<string | null>} 回复正文
 */
export async function replyTextFromMentionGetReply(char, request) {
	const getReply = char?.interfaces?.chat?.GetReply
	if (!getReply) return null
	const reply = await getReply(request)
	const text = reply?.content != null ? String(reply.content).trim() : ''
	return text || null
}
