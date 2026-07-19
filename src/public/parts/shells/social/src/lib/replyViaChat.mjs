/**
 * social OnMessage 意愿 true 或无 OnMessage 且被 @ 时，经 chat.GetReply 生成公开回复正文。
 */
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../../../chat/src/chat/session/builtinParts.mjs'

/**
 * @param {string} username replica
 * @param {string} charPartName chars 目录名
 * @param {object} char char part
 * @param {object} messageEvent SocialMessageEvent 载荷
 * @returns {Promise<string | null>} 回复正文；char 无 GetReply 或回复为空时 null
 */
export async function replyViaChat(username, charPartName, char, messageEvent) {
	const getReply = char.interfaces?.chat?.GetReply
	if (!getReply) return null

	const now = new Date()
	const entry = {
		name: messageEvent.authorDisplayName || 'user',
		uid: messageEvent.authorEntityHash || undefined,
		time_stamp: now,
		role: 'user',
		content: messageEvent.postText || '',
		files: [],
		extension: {
			platform: 'social',
			postId: messageEvent.post?.id,
			authorEntityHash: messageEvent.authorEntityHash,
		},
	}
	const charInfo = char.info?.['zh-CN'] || char.info?.['en-US'] || {}
	const authorUid = messageEvent.authorEntityHash || ''
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
		chat_name: 'social:post',
		char_id: charPartName,
		username,
		Charname: charInfo.name || charPartName,
		CharUid: '',
		UserCharname: messageEvent.authorDisplayName || 'user',
		UserUid: authorUid,
		ReplyToCharname: messageEvent.authorDisplayName,
		ReplyToUid: authorUid,
		locales: [{ code: messageEvent.locale || 'zh-CN' }],
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
			post: {
				id: messageEvent.post?.id,
				authorEntityHash: messageEvent.authorEntityHash,
			},
		},
		/** @returns {Promise<null>} social 请求不支持追加消息 */
		AddChatLogEntry: async () => null,
		/** @returns {Promise<object>} 原样返回请求自身（无会话可刷新） */
		Update: async function update() { return this },
	}

	const reply = await getReply(request)
	return String(reply?.content ?? '').trim() || null
}
