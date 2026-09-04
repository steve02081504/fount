/**
 * code shell 会话请求构建：手构 chatReplyRequest_t 并触发角色 GetReply。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../../decl/chatLog.ts').chatReply_t} chatReply_t
 * @typedef {import('../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t
 * @typedef {import('./sessions.mjs').codeSession_t} codeSession_t
 */
import { localhostLocales } from '../../../../../scripts/i18n/bare.mjs'
import { getPartInfo } from '../../../../../scripts/locale.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../server/parts_loader.mjs'

import { codeWorld } from './world.mjs'

/**
 * 会话条目转 chatLogEntry_t。
 * @param {codeSession_t['entries']} entries - 会话条目。
 * @returns {chatLogEntry_t[]} 聊天日志条目。
 */
function sessionToChatLog(entries) {
	return entries.map(entry => ({
		id: entry.id,
		uid: entry.uid || (entry.role === 'char' ? 'char' : entry.role === 'user' ? 'user' : 'system'),
		role: entry.role,
		name: entry.name,
		content: entry.content,
		time_stamp: entry.time,
		files: [],
		extension: entry.extension ?? {},
	}))
}

/**
 * 构建 chatReplyRequest_t。
 * @param {object} options - 构建参数。
 * @param {string} options.username - 用户名。
 * @param {codeSession_t} options.session - 会话（entries 需已包含本次用户消息）。
 * @param {string} options.machine - 目标机器标识（"0" = 本机）。
 * @param {string} options.workdir - 工作目录（工作区根）。
 * @param {string} [options.ai_source] - 请求级 AI 源 partname（"shells/code 前端下拉值"；空 = 角色自带），构造时 loadPart 为实例。
 * @param {string} [options.profile] - 所选 profile（mode）名。
 * @param {(reply: chatReply_t) => void} [options.onPreview] - 流式预览回调。
 * @param {AbortSignal} [options.signal] - 中断信号。
 * @returns {Promise<chatReplyRequest_t>} 构建好的请求。
 */
async function buildCodeChatRequest({ username, session, machine, workdir, ai_source, profile, onPreview, signal }) {
	const char = await loadPart(username, 'chars/' + session.charname)
	const personaName = getAnyPreferredDefaultPart(username, 'personas')
	const user = personaName ? await loadPart(username, 'personas/' + personaName) : null
	const plugins = {
		'code-execution': await loadPart(username, 'plugins/code-execution'),
		'file-operations': await loadPart(username, 'plugins/file-operations'),
	}
	// ai_source 请求级覆盖：loadPart 出实例后传给角色（args.ai_source 为部件实例）
	const aiSourceInstance = ai_source ? await loadPart(username, 'serviceSources/AI/' + ai_source) : undefined
	const Charname = (await getPartInfo(char, localhostLocales)).name
	return {
		supported_functions: {
			markdown: true,
			mathjax: false,
			html: true,
			unsafe_html: false,
			files: true,
			add_message: false,
			fount_i18nkeys: false,
			fount_assets: false,
			fount_themes: false,
		},
		chat_name: 'code-' + session.id,
		char_id: session.charname,
		username,
		Charname,
		UserCharname: username,
		UserUid: 'user',
		CharUid: 'char',
		locales: localhostLocales,
		time: new Date(),
		chat_log: sessionToChatLog(session.entries),
		timelines: [],
		world: codeWorld,
		user,
		char,
		other_chars: [],
		plugins,
		chat_summary: '',
		chat_scoped_char_memory: session.memory ??= {},
		extension: {
			code: { profile },
		},
		ai_source: aiSourceInstance,
		workdir: { machine: String(machine ?? '0'), path: workdir },
		generation_options: {
			/**
			 * 转发流式预览。
			 * @param {import('../../../../../decl/chatLog.ts').chatReply_t} reply - 预览回复。
			 * @returns {void}
			 */
			replyPreviewUpdater: reply => onPreview?.(reply),
			signal,
		},
	}
}

/**
 * 触发角色回复（含 world GetCharReply 钩子优先）。
 * @param {object} options - 同 buildCodeChatRequest。
 * @returns {Promise<{reply: chatReply_t|null, memory: object}>} 角色回复与（可能被插件就地更新的）chat_scoped_char_memory。
 */
export async function triggerCodeReply(options) {
	const request = await buildCodeChatRequest(options)
	const worldReply = await request.world.interfaces.chat.GetCharReply?.(request, request.char_id)
	const reply = worldReply ?? await request.char.interfaces.chat.GetReply(request)
	return { reply, memory: request.chat_scoped_char_memory }
}
