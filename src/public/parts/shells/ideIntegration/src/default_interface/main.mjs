/**
 * IDE 集成默认接口：实现 SetupSession / Reply / TeardownSession。
 * 当角色未提供 char.interfaces.ideIntegration 时，由 getIDEInterface() 创建此默认实现。
 */
import { Buffer } from 'node:buffer'

import { geti18nForLocales, localhostLocales } from '../../../../../../scripts/i18n.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../../../server/auth.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'
import { createBufferedLineBasedStream } from '../../../chat/src/stream.mjs'

import { buildACPClientToolsPlugin } from './acp_client_tools_plugin.mjs'
import { buildMCPPlugin } from './mcp_plugin.mjs'

/**
 * 从消息列表构建 chat_log（供 GetReply 使用）。
 * @param {Array<{ role: 'user'|'char'|'system', content: string, name?: string, files?: Array }>} messages - 消息列表。
 * @returns {object[]} 符合 chatLogEntry 形状的普通对象数组。
 */
function buildChatLogFromMessages(messages) {
	return messages.map((m) => ({
		id: crypto.randomUUID(),
		name: m.name ?? (m.role === 'user' ? 'User' : 'Assistant'),
		avatar: '',
		time_stamp: Date.now(),
		role: m.role,
		content: m.content,
		files: m.files || [],
		logContextBefore: [],
		logContextAfter: [],
		extension: {},
	}))
}

/**
 * 创建默认的 IDE 集成接口。
 * @param {import('../../../../../../decl/charAPI.ts').CharAPI_t} charAPI - 角色 API。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色 id。
 * @returns {Promise<{ SetupSession: Function, Reply: Function, TeardownSession: Function }>} IDE 集成接口。
 */
export async function createDefaultIDEInterface(charAPI, username, charname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for IDE Integration.')

	const Charname = (await getPartInfo(charAPI, localhostLocales))?.name ?? charname
	const user = await (async () => {
		const n = getAnyPreferredDefaultPart(username, 'personas')
		return n ? loadPart(username, 'personas/' + n) : null
	})()

	/**
	 * 新会话创建时调用：初始化 MCP 客户端并构建插件。
	 * @param {{ cwd?: string, mcpServers?: Array, connection?: object }} opts - 设置选项。
	 * @returns {Promise<{ mcpPlugins: Record<string, object>, mcpClients: Array }>} MCP 插件和客户端。
	 */
	async function SetupSession({ cwd, mcpServers } = {}) {
		const mcpPlugins = {}
		const mcpClients = []

		if (mcpServers?.length) {
			const results = await Promise.allSettled(
				mcpServers.map(server => buildMCPPlugin(server, { cwd }))
			)
			for (const settled of results)
				if (settled.status === 'fulfilled') {
					const { client, plugin } = settled.value
					mcpClients.push(client)
					mcpPlugins[plugin.info[''].name] = plugin
				}
		}

		return { mcpPlugins, mcpClients }
	}

	/**
	 * 处理用户消息并返回回复。支持流式预览与中止。
	 * @param {Array<{ role: string, content: string, name?: string, files?: Array }>} messages - 消息列表。
	 * @param {{ mcpPlugins?: Record<string, object>, mcpClients?: Array }} [sessionData] - 会话数据。
	 * @param {{ sessionId?: string, connection?: object, signal?: AbortSignal, clientCapabilities?: object }} [options] - 用于流式、中止与客户端工具插件。
	 * @returns {Promise<{ content: string, content_for_show?: string, name?: string, files?: Array } | null>} 回复结果。
	 */
	async function Reply(messages, sessionData = {}, options = {}) {
		const chat_log = buildChatLogFromMessages(messages)
		const plugins = { ...sessionData.mcpPlugins }

		if (options.connection && options.sessionId && options.clientCapabilities) {
			const acpTools = buildACPClientToolsPlugin(options.connection, options.sessionId, options.clientCapabilities)
			if (acpTools) plugins[acpTools.info[''].name] = acpTools
		}

		// 将 ACP 上下文注入 extension.acp，所有插件可用于 tool_call 报告、plan 等
		const acpContext = options.connection && options.sessionId
			? { connection: options.connection, sessionId: options.sessionId }
			: null

		const locales = [...getUserByUsername(username)?.locales ?? [], ...localhostLocales]

		const request = {
			supported_functions: {
				markdown: true,
				mathjax: true,
				html: false,
				unsafe_html: false,
				files: true,
				add_message: false,
				fount_i18nkeys: false,
				fount_assets: false,
			},
			chat_name: 'ide-integration-' + Date.now(),
			char_id: charname,
			username,
			Charname,
			UserCharname: (await getPartInfo(user, locales))?.name ?? username,
			locales,
			time: new Date(),
			world: null,
			user,
			char: charAPI,
			other_chars: {},
			plugins,
			chat_summary: '',
			chat_scoped_char_memory: {},
			chat_log,
			extension: { ...acpContext && { acp: acpContext } },
		}

		let bufferedStream = null
		if (options.connection && options.sessionId)
			bufferedStream = createBufferedLineBasedStream({
				/** @param {string} piece - 文本片段。 */
				onChunk: (piece) => {
					options.connection.sessionUpdate({
						sessionId: options.sessionId,
						update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: piece } },
					})
				},
				/** @param {{ buffer: ArrayBuffer|Buffer|Uint8Array, mime_type?: string }} file - 文件对象。 */
				onFile: (file) => {
					if (!file?.buffer) return
					const mime = file.mime_type || 'application/octet-stream'
					const base64 = Buffer.from(file.buffer).toString('base64')
					if (mime.startsWith('image/'))
						options.connection.sessionUpdate({
							sessionId: options.sessionId,
							update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: base64, mimeType: mime } },
						})
					else if (mime.startsWith('audio/'))
						options.connection.sessionUpdate({
							sessionId: options.sessionId,
							update: { sessionUpdate: 'agent_message_chunk', content: { type: 'audio', data: base64, mimeType: mime } },
						})
				},
				signal: options.signal,
			})


		if (options.signal || options.connection) {
			request.generation_options = {}
			if (options.signal)
				request.generation_options.signal = options.signal
			if (bufferedStream)
				request.generation_options.replyPreviewUpdater = bufferedStream.update
		}

		const result = await charAPI.interfaces.chat.GetReply(request)
		if (!result) return null

		if (bufferedStream) {
			const displayContent = result.content_for_show || result.content || ''
			await bufferedStream.finish(displayContent, result.files || [], geti18nForLocales(locales, 'chat.messageView.noReplyContent'))
		}

		return {
			content: result.content ?? '',
			content_for_show: result.content_for_show,
			name: result.name,
			files: result.files,
		}
	}

	/**
	 * 会话结束时调用：停止所有 MCP 客户端。
	 * @param {{ mcpClients?: Array }} [sessionData] - 会话数据。
	 */
	async function TeardownSession(sessionData = {}) {
		if (sessionData.mcpClients)
			for (const client of sessionData.mcpClients)
				await client.stop().catch(error => console.error('MCP client stop failed:', error))
	}

	return { SetupSession, Reply, TeardownSession }
}
