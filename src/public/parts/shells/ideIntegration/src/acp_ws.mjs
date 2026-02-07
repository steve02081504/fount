/**
 * ACP 协议层：仅负责 ACP JSON-RPC 协议解析与内容提取。
 * 所有业务逻辑委托给角色的 ideIntegration 接口（通过 getIDEInterface 加载）。
 */
import { Buffer } from 'node:buffer'

import {
	AgentSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from 'npm:@agentclientprotocol/sdk'

import { unlockAchievement } from '../../achievements/src/api.mjs'

import { getIDEInterface } from './reply.mjs'

/** MIME → 扩展名映射（用于从 ACP 内容块生成文件名）。 */
const MIME_EXT = {
	'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
	'image/webp': '.webp', 'image/svg+xml': '.svg',
	'audio/wav': '.wav', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/webm': '.webm',
	'video/mp4': '.mp4', 'video/webm': '.webm',
}

/**
 * 从 ACP prompt 内容块中提取纯文本与文件附件。
 * @param {Array<import('npm:@agentclientprotocol/sdk').ContentBlock>} blocks - ACP 内容块数组。
 * @returns {{ text: string, files: Array<{ name: string, mime_type: string, buffer: Buffer }> }} 提取的文本和文件。
 */
function extractPromptContent(blocks) {
	if (!Array.isArray(blocks)) return { text: '', files: [] }

	const textParts = []
	const files = []
	let fileIdx = 0

	for (const block of blocks) {
		if (!block) continue
		switch (block.type) {
			case 'text':
				if (block.text) textParts.push(block.text)
				break

			case 'image':
				if (block.data)
					files.push({
						name: `image_${++fileIdx}${MIME_EXT[block.mimeType] || '.bin'}`,
						mime_type: block.mimeType || 'image/png',
						buffer: Buffer.from(block.data, 'base64'),
					})
				break

			case 'audio':
				if (block.data)
					files.push({
						name: `audio_${++fileIdx}${MIME_EXT[block.mimeType] || '.bin'}`,
						mime_type: block.mimeType || 'audio/wav',
						buffer: Buffer.from(block.data, 'base64'),
					})
				break

			case 'resource': {
				const res = block.resource
				if (!res) break
				if (res.text != null) {
					const name = res.uri?.split('/').pop() || 'resource'
					textParts.push(`[${name}]\n${res.text}`)
				} else if (res.blob) {
					const name = res.uri?.split('/').pop() || `resource_${++fileIdx}`
					files.push({
						name,
						mime_type: res.mimeType || 'application/octet-stream',
						buffer: Buffer.from(res.blob, 'base64'),
					})
				}
				break
			}

			case 'resource_link':
				if (block.uri)
					textParts.push(`[${block.name || block.uri}](${block.uri})`)
				break

			default:
				if (block.text) textParts.push(block.text)
				break
		}
	}

	return { text: textParts.join('\n').trim(), files }
}

/**
 * 服务端 ACP Agent：桥接 ACP 协议与角色 ideIntegration 接口。
 * 所有业务逻辑（含 slash 命令、config options、modes）均由接口提供，此处仅转发。
 */
class ServerFountAgent {
	/** @type {{ SetupSession?: Function, Reply: Function, TeardownSession?: Function, SetSessionConfigOption?: Function, SetSessionMode?: Function }|null} */
	#iface = null

	/**
	 * @param {AgentSideConnection} connection - ACP 连接对象。
	 * @param {string} username - 用户名。
	 * @param {string} charname - 角色名。
	 */
	constructor(connection, username, charname) {
		this.connection = connection
		this.username = username
		this.charname = charname
		/** @type {Map<string, { history: Array, pendingPrompt: AbortController|null, sessionData: object|null }>} */
		this.sessions = new Map()
		/** @type {import('npm:@agentclientprotocol/sdk').ClientCapabilities|null} */
		this.clientCapabilities = null
	}

	/**
	 * 懒加载角色的 ideIntegration 接口。
	 * @returns {Promise<{ SetupSession?: Function, Reply: Function, TeardownSession?: Function, SetSessionConfigOption?: Function, SetSessionMode?: Function }>} IDE 接口。
	 */
	async #getInterface() {
		if (!this.#iface)
			this.#iface = await getIDEInterface(this.username, this.charname)
		return this.#iface
	}

	/**
	 * 初始化 ACP 连接。
	 * @param {object} params - 初始化参数。
	 * @returns {Promise<object>} 初始化响应。
	 */
	async initialize(params) {
		this.clientCapabilities = params.clientCapabilities ?? {}
		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
				mcpCapabilities: { http: true, sse: true },
				promptCapabilities: { image: true, audio: true, embeddedContext: true },
				sessionCapabilities: {},
			},
			agentInfo: { name: 'fount-ide', title: 'fount', version: '0.0.0' },
			authMethods: [],
		}
	}

	/**
	 * 创建新会话。接口 SetupSession 返回的 sessionData 中可包含 configOptions / modes / availableCommands，
	 * 由此处转发给客户端，实现自定义界面对 ACP 会话属性的完全控制。
	 * @param {object} params - 会话参数。
	 * @returns {Promise<object>} 会话响应（含 sessionId 及接口提供的 configOptions/modes）。
	 */
	async newSession(params) {
		const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')

		let sessionData = null
		try {
			const iface = await this.#getInterface()
			if (iface.SetupSession)
				sessionData = await iface.SetupSession({
					cwd: params.cwd || '',
					mcpServers: params.mcpServers || [],
					connection: this.connection,
				})
		} catch (error) {
			console.error('SetupSession failed:', error)
		}

		this.sessions.set(sessionId, {
			history: [],
			pendingPrompt: null,
			sessionData,
			cwd: params.cwd || '',
			mcpServers: params.mcpServers || [],
		})

		const response = { sessionId }

		// 转发接口提供的 ACP 会话属性
		if (sessionData?.configOptions) response.configOptions = sessionData.configOptions
		if (sessionData?.modes) response.modes = sessionData.modes

		// 发送接口提供的可用命令
		if (sessionData?.availableCommands?.length)
			this.connection.sessionUpdate({
				sessionId,
				update: { sessionUpdate: 'available_commands_update', availableCommands: sessionData.availableCommands },
			})

		return response
	}

	/**
	 * 认证（空实现，认证由 WebSocket 路由层完成）。
	 * @returns {Promise<object>} 空对象。
	 */
	async authenticate() { return {} }

	/**
	 * 设置会话模式。若接口提供 SetSessionMode，转发给接口处理。
	 * @param {object} params - 模式参数。
	 * @returns {Promise<object>} 模式响应。
	 */
	async setSessionMode(params) {
		const session = this.sessions.get(params.sessionId)
		if (!session) throw new Error(`Session ${params.sessionId} not found`)

		const iface = await this.#getInterface()
		if (iface.SetSessionMode)
			return await iface.SetSessionMode(params, session.sessionData)

		return {}
	}

	/**
	 * 忽略未知通知（如客户端发送的 initialized），避免 Method not found 断连。
	 */
	async extNotification() { }

	/**
	 * 处理用户 prompt。
	 * @param {object} params - Prompt 参数。
	 * @returns {Promise<{ stopReason: string }>} 停止原因。
	 */
	async prompt(params) {
		const session = this.sessions.get(params.sessionId)
		if (!session)
			throw new Error(`Session ${params.sessionId} not found`)

		session.pendingPrompt?.abort()
		session.pendingPrompt = new AbortController()
		const { signal } = session.pendingPrompt

		try {
			const { text: userText, files } = extractPromptContent(params.prompt || [])

			if (!userText && !files.length) {
				await this.connection.sessionUpdate({
					sessionId: params.sessionId,
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '(Please enter a message before sending.)' } },
				})
				session.pendingPrompt = null
				return { stopReason: 'end_turn' }
			}

			const messages = [
				...session.history.map((m) => ({ role: m.role, content: m.content, files: m.files })),
				{ role: 'user', content: userText, files },
			]

			const iface = await this.#getInterface()
			const replyOptions = {
				sessionId: params.sessionId,
				connection: this.connection,
				signal,
				clientCapabilities: this.clientCapabilities ?? {},
			}
			const result = await iface.Reply(messages, session.sessionData, replyOptions)

			if (signal.aborted) {
				session.pendingPrompt = null
				return { stopReason: 'cancelled' }
			}

			if (!result) {
				await this.connection.sessionUpdate({
					sessionId: params.sessionId,
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Error: no reply' } },
				})
				session.pendingPrompt = null
				return { stopReason: 'end_turn' }
			}

			// 推流（含结束后补最后一行、附件前换行、发文件）由接口在 Reply 内完成，协议层只做历史与 stopReason
			const canonicalContent = result.content ?? ''
			session.history.push({ role: 'user', content: userText, files })
			session.history.push({ role: 'char', content: canonicalContent })
			session.pendingPrompt = null
			return { stopReason: 'end_turn' }
		} catch (error) {
			if (error.name === 'AbortError' || session.pendingPrompt?.signal?.aborted) {
				session.pendingPrompt = null
				return { stopReason: 'cancelled' }
			}
			session.pendingPrompt = null
			throw error
		}
	}

	/**
	 * 设置会话配置选项。若接口提供 SetSessionConfigOption，转发给接口处理。
	 * @param {object} params - 配置参数。
	 * @returns {Promise<{ configOptions: Array }>} 配置选项列表。
	 */
	async setSessionConfigOption(params) {
		const session = this.sessions.get(params.sessionId)
		if (!session) throw new Error(`Session ${params.sessionId} not found`)

		const iface = await this.#getInterface()
		if (iface.SetSessionConfigOption)
			return await iface.SetSessionConfigOption(params, session.sessionData)

		return { configOptions: [] }
	}

	/**
	 * 取消当前 prompt。
	 * @param {object} params - 取消参数。
	 */
	async cancel(params) {
		this.sessions.get(params.sessionId)?.pendingPrompt?.abort()
	}

	/**
	 * 清理所有会话资源（WebSocket 关闭时调用）。
	 */
	async teardownAll() {
		const iface = this.#iface
		if (!iface?.TeardownSession) return
		for (const [, session] of this.sessions)
			if (session.sessionData)
				await iface.TeardownSession(session.sessionData).catch(error => console.error('TeardownSession failed:', error))

		this.sessions.clear()
	}
}

/**
 * 从 WebSocket 构建 ACP 所需的 duplex stream（ndjson）。
 * @param {import('npm:ws').WebSocket} ws - WebSocket 对象。
 * @returns {object} Duplex stream 对象。
 */
function wsToStream(ws) {
	const readable = new ReadableStream({
		/**
		 * 启动 ReadableStream。
		 * @param {object} controller - ReadableStreamDefaultController。
		 */
		start(controller) {
			ws.on('message', data =>
				controller.enqueue(Object(data) instanceof String ? new TextEncoder().encode(data) : new Uint8Array(data))
			)
			ws.on('close', () => controller.close())
			ws.on('error', () => controller.error(new Error('WebSocket error')))
		},
	})
	const writable = new WritableStream({
		/**
		 * 写入数据到 WebSocket。
		 * @param {string|Uint8Array} chunk - 要写入的数据块。
		 */
		write(chunk) {
			ws.send(Object(chunk) instanceof String ? chunk : new TextDecoder().decode(chunk))
		},
	})
	return ndJsonStream(writable, readable)
}

/**
 * 处理 ACP WebSocket 连接。认证由路由层完成（req.user）；charname 从 URL query 解析。
 * @param {import('npm:ws').WebSocket} ws - WebSocket 对象。
 * @param {import('npm:express').Request} req - Express 请求对象。
 */
export async function handleAcpWs(ws, req) {
	if (!req.user?.username) {
		ws.close(4001, 'Unauthorized')
		return
	}
	const query = req.url?.includes('?')
		? Object.fromEntries(new URLSearchParams(req.url.slice(req.url.indexOf('?'))))
		: {}
	const charname = query['charname']
	if (!charname) {
		ws.close(4003, 'Missing charname')
		return
	}

	/** @type {ServerFountAgent|null} */
	let agent = null

	ws.on('close', async () => {
		if (agent) await agent.teardownAll()
	})

	const stream = wsToStream(ws)
	new AgentSideConnection(
		connection => {
			agent = new ServerFountAgent(connection, req.user.username, charname)
			unlockAchievement(req.user.username, 'shells/ideIntegration', 'first_ide_use')
			return agent
		},
		stream,
	)
}
