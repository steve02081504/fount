/**
 * code shell 会话请求构建：手构 chatReplyRequest_t 并触发角色 GetReply。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../../decl/chatLog.ts').chatReply_t} chatReply_t
 * @typedef {import('../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t
 * @typedef {import('./sessions.mjs').codeSession_t} codeSession_t
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { localhostLocales } from '../../../../../scripts/i18n/bare.mjs'
import { getPartInfo } from '../../../../../scripts/locale.mjs'
import { guardOutput } from '../../../../../scripts/shell_guard.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../server/parts_loader.mjs'

import { codeWorld } from './world.mjs'

/** `!` 用户命令 prompt 层截断结果的缓存（键：entry.id + 内容长度）。 */
const shellLogGuardCache = new Map()

/**
 * 对 `!` 用户命令日志做 prompt 层截断（页面条目不受影响），带缓存避免重复落盘。
 * @param {object} entry - 会话条目。
 * @returns {Promise<string>} 供 AI 使用的内容。
 */
async function guardShellLogContent(entry) {
	const content = String(entry.content ?? '')
	const key = `${entry.id}:${content.length}`
	const cached = shellLogGuardCache.get(key)
	if (cached !== undefined) return cached
	const guarded = await guardOutput(content, { name: 'shell-command', label: 'shell 输出' })
	shellLogGuardCache.set(key, guarded.text)
	if (shellLogGuardCache.size > 200) shellLogGuardCache.delete(shellLogGuardCache.keys().next().value)
	return guarded.text
}

/**
 * 解码条目附件 buffer（前端经 WS 存 base64 字符串；服务端转回 Buffer 供 AI 源读取）。
 * @param {Buffer|string|Uint8Array|null} value - buffer 或 base64 字符串。
 * @returns {Buffer} 解码后的 buffer。
 */
function decodeFileBuffer(value) {
	if (!value) return Buffer.alloc(0)
	if (Buffer.isBuffer(value)) return value
	return Buffer.from(String(value), 'base64')
}

/**
 * 会话条目转 chatLogEntry_t。
 * `!` 用户命令的 tool 日志在 prompt 层做头尾截断（完整内容仍保留在页面条目中）。
 * @param {codeSession_t['entries']} entries - 会话条目。
 * @returns {Promise<chatLogEntry_t[]>} 聊天日志条目。
 */
async function sessionToChatLog(entries) {
	return await Promise.all(entries.map(async entry => ({
		id: entry.id,
		uid: entry.uid || (entry.role === 'char' ? 'char' : entry.role === 'user' ? 'user' : 'system'),
		role: entry.role,
		name: entry.name,
		content: entry.role === 'tool' && entry.name === 'shell' ? await guardShellLogContent(entry) : entry.content,
		time_stamp: entry.time,
		files: (entry.files || []).map(file => ({ name: file.name, mime_type: file.mime_type, buffer: decodeFileBuffer(file.buffer), description: file.description || '' })),
		extension: entry.extension ?? {},
	})))
}

/**
 * 构建 chatReplyRequest_t。
 * @param {object} options - 构建参数。
 * @param {string} options.username - 用户名。
 * @param {codeSession_t} options.session - 会话（entries 需已包含本次用户消息）。
 * @param {codeSession_t} [options.requestSession] - 请求侧会话；提供时把本轮 `result` 暴露到 `requestSession.generationResult`，供 WS 预览增量读取已累计的工具日志。
 * @param {string} options.machine - 目标机器标识（"0" = 本机）。
 * @param {string} options.workdir - 工作目录（工作区根）。
 * @param {string} [options.ai_source] - 请求级 AI 源 partname（"shells/code 前端下拉值"；空 = 角色自带），构造时 loadPart 为实例。
 * @param {string} [options.profile] - 所选 profile（mode）名。
 * @param {string} [options.generationId] - 本轮生成 id（供子代理回链父代生成；缺省由调用方生成）。
 * @param {(reply: chatReply_t) => void} [options.onPreview] - 流式预览回调。
 * @param {(event: object) => void} [options.onToolOutput] - 工具执行实时输出回调（`generation_options.onToolOutput`）。
 * @param {AbortSignal} [options.signal] - 中断信号。
 * @returns {Promise<chatReplyRequest_t>} 构建好的请求。
 */
async function buildCodeChatRequest({ username, session, requestSession, machine, workdir, ai_source, profile, generationId, onPreview, onToolOutput, signal }) {
	const char = await loadPart(username, 'chars/' + session.charname)
	const personaName = getAnyPreferredDefaultPart(username, 'personas')
	const user = personaName ? await loadPart(username, 'personas/' + personaName) : null
	const plugins = {
		'code-execution': await loadPart(username, 'plugins/code-execution'),
		'file-operations': await loadPart(username, 'plugins/file-operations'),
		'async-task': await loadPart(username, 'plugins/async-task'),
	}
	// ai_source 请求级覆盖：loadPart 出实例后传给角色（args.ai_source 为部件实例）
	const aiSourceInstance = ai_source ? await loadPart(username, 'serviceSources/AI/' + ai_source) : undefined
	const Charname = (await getPartInfo(char, localhostLocales)).name
	/** code shell 声明的能力档（请求顶层与 generation_options 同值：AI 源自后者读取）。 */
	const supported_functions = {
		markdown: true,
		mathjax: true,
		html: true,
		unsafe_html: true,
		files: true,
		add_message: true,
		fount_i18nkeys: true,
		fount_assets: true,
		fount_themes: true,
	}
	/**
	 * 生成选项。`base_result` 由角色模板在每轮 `StructCall` 前写入（累计结果容器，含 `logContextBefore`）；
	 * WS 增量条目据此读取，而不是 AI 源构造的预览副本（那通常不带累计日志）。
	 */
	const generation_options = {
		supported_functions,
		/**
		 * 转发流式预览；并把本轮累计结果暴露给调用方（WS）以增量读取 `logContextBefore`。
		 * @param {import('../../../../../decl/chatLog.ts').chatReply_t} reply - 预览回复。
		 * @returns {void}
		 */
		replyPreviewUpdater: reply => {
			if (requestSession) requestSession.generationResult = generation_options.base_result ?? reply
			onPreview?.(reply)
		},
		/** 工具执行实时输出（code-execution 插件回调），远程流式回显经 `shells/code` 的 RemoteCallBack。 */
		onToolOutput,
		remoteToolCallbackPartpath: onToolOutput ? 'shells/code' : undefined,
		signal,
	}
	return {
		supported_functions,
		chat_name: 'code-' + session.id,
		// 稳定会话标识：Agent Studio 据此归组与复原对话
		chat_id: 'code-' + session.id,
		char_id: session.charname,
		username,
		Charname,
		UserCharname: username,
		UserUid: 'user',
		CharUid: 'char',
		locales: localhostLocales,
		time: new Date(),
		chat_log: await sessionToChatLog(session.entries),
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
			...generationId ? { generationId } : {},
			// 主动记录 API 读取的记录来源（角色模板内调用 request_record.mjs）
			agentStudio: { source: 'shells/code' },
		},
		/**
		 * 重读会话条目并重建请求（供轮次刷新 `injectRoundEntries` 采集新条目）。
		 * @returns {Promise<object>} 刷新后的请求
		 */
		Update: () => buildCodeChatRequest({ username, session, machine, workdir, ai_source, profile, generationId, onPreview, onToolOutput, signal }),
		/**
		 * 追加一条日志条目。`role === 'char'`（或缺省）作为角色回复写入；其余 role（异步完成通知等）额外
		 * 推送 `code-async-entry` 事件，让前端持久化并在空闲时触发生成。
		 * @param {object} entry 条目
		 * @returns {Promise<void>}
		 */
		AddChatLogEntry: async entry => {
			const role = entry?.role ?? 'char'
			const content = String(entry?.content ?? '')
			const show = entry?.content_for_show
			const edit = entry?.content_for_edit
			const normalized = {
				id: entry?.id ?? randomUUID(),
				uid: entry?.uid ?? (role === 'char' ? 'char' : role === 'user' ? 'user' : 'system'),
				role,
				name: entry?.name ?? (role === 'char' ? 'char' : 'system'),
				content,
				...show != null && show !== content ? { content_for_show: String(show) } : {},
				...edit != null && edit !== content ? { content_for_edit: String(edit) } : {},
				...Array.isArray(entry?.charVisibility) && entry.charVisibility.length ? { charVisibility: entry.charVisibility.map(String) } : {},
				time: entry?.time_stamp instanceof Date ? entry.time_stamp.toISOString() : String(entry?.time_stamp ?? new Date().toISOString()),
				files: [],
			}
			session.entries.push(normalized)
			if (role === 'char') return
			try {
				const { sendEventToUser } = await import('../../../../../server/web_server/event_dispatcher.mjs')
				sendEventToUser(username, 'code-async-entry', { chatName: 'code-' + session.id, entry: normalized })
			}
			catch (error) {
				console.warn('code shell: 异步通知事件发送失败', error)
			}
		},
		/**
		 * 轮次刷新已让角色看到新内容：通知前端清除「待补触发」标记，避免生成结束再补一次。
		 * @returns {void}
		 */
		ClearPendingMessages: () => {
			void import('../../../../../server/web_server/event_dispatcher.mjs').then(({ sendEventToUser }) => {
				sendEventToUser(username, 'code-async-consumed', { chatName: 'code-' + session.id })
			}).catch(error => {
				console.warn('code shell: 异步通知消费事件发送失败', error)
			})
		},
		ai_source: aiSourceInstance,
		workdir: session.memory.workdir ?? { machine: String(machine ?? '0'), path: workdir },
		generation_options,
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
