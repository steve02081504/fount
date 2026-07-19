/**
 * social OnMessage 意愿 true 或无 OnMessage 且被 @ 时，经 chat.GetReply 生成公开回复正文。
 *
 * Uid 语义与 chat 一致：
 * - User* = 本机 operator（主人）
 * - Char* = 正在回复的 local agent
 * - ReplyTo* = 帖作者（回复对象）
 * - chat_log 行 uid = 帖作者
 */
import { formatHashShort } from 'fount/public/parts/shells/chat/public/shared/entityHash.mjs'

import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../../../chat/src/chat/session/builtinParts.mjs'
import { resolveOperatorEntityHashForUser } from '../../../chat/src/entity/identity.mjs'

import { getEntityProfile } from './entityProfile.mjs'

/**
 * @param {string} username replica
 * @param {string} entityHash entityHash
 * @returns {Promise<string>} 展示名
 */
async function displayNameForEntity(username, entityHash) {
	const profile = entityHash ? await getEntityProfile(username, entityHash) : null
	return profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 4 }) || 'user'
}

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
	const authorUid = String(messageEvent.authorEntityHash || '').trim().toLowerCase() || 'user'
	const authorName = messageEvent.authorDisplayName || await displayNameForEntity(username, authorUid)
	const charUid = String(messageEvent.viewerEntityHash || '').trim().toLowerCase() || 'char'
	const operatorUid = await resolveOperatorEntityHashForUser(username) || 'user'
	const operatorName = await displayNameForEntity(username, operatorUid)

	const entry = {
		name: authorName,
		uid: authorUid,
		time_stamp: now,
		role: 'user',
		content: messageEvent.postText || '',
		files: [],
		extension: {
			platform: 'social',
			postId: messageEvent.post?.id,
			authorEntityHash: authorUid,
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
		chat_name: 'social:post',
		char_id: charPartName,
		username,
		Charname: charInfo.name || charPartName,
		CharUid: charUid,
		UserCharname: operatorName,
		UserUid: operatorUid,
		ReplyToCharname: authorName,
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
				authorEntityHash: authorUid,
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
