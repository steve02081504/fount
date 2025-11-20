import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * MCP 客户端 - 参考 mcp.el 实现
 * 支持 stdio 连接方式，通过 JSON-RPC 2.0 与 MCP 服务器通信
 * 支持 SSE (Server-Sent Events) 连接方式，用于 HTTPS 连接
 */

/**
 * 创建一个 MCP 客户端实例
 * @param {object} config - MCP 服务器配置
 * @param {string} [config.command] - 启动命令 (stdio 模式)
 * @param {string[]} [config.args] - 命令参数 (stdio 模式)
 * @param {Record<string, string>} [config.env] - 环境变量 (stdio 模式)
 * @param {string} [config.url] - 服务器 URL (SSE 模式)
 * @param {Array<string|object>} [config.roots] - 根目录列表
 * @param {Function} [config.samplingHandler] - 采样处理器，接受 params 并返回生成的消息
 * @returns {object} MCP 客户端实例
 */
export function createMCPClient(config) {
	let mcp_process = null
	let sse_client = null
	let sse_post_url = null
	let messageId = 0
	const pendingRequests = new Map()

	// MCP 状态
	let status = 'init'
	let capabilities = null
	let serverInfo = null
	let tools = []
	let prompts = []
	let resources = []
	let resourceTemplates = []
	let roots = config.roots || []
	let samplingHandler = config.samplingHandler || null

	/**
	 * 启动 MCP 服务器进程或连接
	 */
	async function start() {
		if (mcp_process || sse_client) return

		if (config.url) // SSE 模式
			await startSSE()
		else if (config.command) // Stdio 模式
			await startStdio()
		else
			throw new Error('Invalid MCP config: missing command or url')

		// 初始化连接
		await initialize()
	}

	/**
	 * 启动 SSE 连接
	 */
	async function startSSE() {
		return new Promise((resolve, reject) => {
			try {
				sse_client = new EventSource(config.url)

				sse_client.onopen = () => {
					console.log(`[MCP] SSE connection opened to ${config.url}`)
				}

				sse_client.onerror = (err) => {
					console.error('[MCP] SSE error:', err)
					if (status === 'init') {
						reject(new Error(`Failed to connect to SSE endpoint: ${config.url}`))
					}
				}

				sse_client.addEventListener('endpoint', (event) => {
					try {
						// endpoint 事件包含用于 POST 请求的 URL
						// 可能是相对路径或绝对路径
						const endpointUrl = event.data
						if (endpointUrl.startsWith('http'))
							sse_post_url = endpointUrl
						else {
							// 拼接相对路径
							const baseUrl = new URL(config.url)
							sse_post_url = new URL(endpointUrl, baseUrl).toString()
						}
						console.log(`[MCP] SSE endpoint received: ${sse_post_url}`)
						resolve()
					} catch (err) {
						reject(new Error(`Failed to parse endpoint URL: ${err.message}`))
					}
				})

				sse_client.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data)
						handleMessage(message)
					} catch (err) {
						console.error('Failed to parse MCP message:', event.data, err)
					}
				}
			} catch (err) {
				reject(err)
			}
		})
	}

	/**
	 * 启动 Stdio 进程
	 */
	async function startStdio() {
		mcp_process = spawn(config.command, config.args || [], {
			env: { ...process.env, ...config.env },
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		const decoder = new TextDecoder()
		let buffer = ''
		mcp_process.stdout.on('data', (data) => {
			buffer += decoder.decode(data, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''

			for (const line of lines) {
				if (!line.trim()) continue
				try {
					const message = JSON.parse(line)
					handleMessage(message)
				} catch (err) {
					console.error('Failed to parse MCP message:', line, err)
				}
			}
		})

		mcp_process.stdout.on('error', (err) => {
			console.error('MCP client read error:', err)
		})

		const stderrDecoder = new TextDecoder()
		mcp_process.stderr.on('data', (data) => {
			const text = stderrDecoder.decode(data, { stream: true })
			if (text.trim())
				console.error('MCP server stderr:', text)
		})
		mcp_process.stderr.on('error', (err) => {
			console.error('MCP stderr read error:', err)
		})
	}

	/**
	 * 处理来自 MCP 服务器的消息
	 * @param {object} message - JSON-RPC 消息
	 */
	function handleMessage(message) {
		// 处理响应
		if (message.id !== undefined && pendingRequests.has(message.id)) {
			const { resolve, reject } = pendingRequests.get(message.id)
			pendingRequests.delete(message.id)

			if (message.error)
				reject(new Error(`[${message.error.code}] ${message.error.message || 'MCP request failed'}`))
			else
				resolve(message.result)

			return
		}

		// 处理服务器发来的请求
		if (message.method && message.id !== undefined) {
			handleServerRequest(message.method, message.params, message.id)
			return
		}

		// 处理通知
		if (message.method && message.id === undefined)
			handleNotification(message.method, message.params)
	}

	/**
	 * 处理服务器通知
	 * @param {string} method - 通知方法名
	 * @param {object} params - 通知参数
	 */
	function handleNotification(method, params) {
		switch (method) {
			case 'notifications/message':
				if (params?.level && params?.data) {
					const logger = params.logger ? `[${params.logger}]` : ''
					console.log(`[MCP][${params.level}]${logger}: ${params.data}`)
				}
				break
			default:
				console.log(`MCP notification: ${method}`, params)
		}
	}

	/**
	 * 处理服务器发来的请求
	 * @param {string} method - 请求方法名
	 * @param {object} params - 请求参数
	 * @param {number} id - 请求 ID
	 */
	async function handleServerRequest(method, params, id) {
		try {
			let result = null

			switch (method) {
				case 'roots/list':
					// 返回客户端的根目录列表
					result = {
						roots: roots.map(root => {
							if (Object(root) instanceof String) {
								// 字符串路径转换为标准格式
								const uri = root.startsWith('file://')
									? root
									: `file://${root.replace(/\\/g, '/')}`
								return {
									uri,
									name: root.split(/[/\\]/).pop() || root
								}
							}
							return root
						})
					}
					break

				case 'sampling/createMessage': {
					// 采样请求 - 调用配置的 sampling handler
					if (!samplingHandler)
						throw new Error('Sampling not supported - no handler configured')

					// 调用 sampling handler 并获取结果
					const samplingResult = await samplingHandler(params)

					// 格式化为 MCP 协议要求的格式
					result = {
						role: 'assistant',
						content: {
							type: 'text',
							text: samplingResult
						}
					}
					break
				}
				default:
					throw new Error(`Unknown method: ${method}`)
			}

			// 发送响应
			await sendResponse(id, result)
		} catch (err) {
			// 发送错误响应
			await sendErrorResponse(id, -32603, err.message || 'Internal error')
		}
	}

	/**
	 * 发送消息到 MCP 服务器
	 * @param {object} message - JSON-RPC 消息
	 */
	async function sendMessage(message) {
		if (mcp_process) {
			// Stdio 模式
			const messageText = JSON.stringify(message) + '\n'
			mcp_process.stdin.write(messageText)
		}
		else if (sse_post_url) try { // SSE 模式
			const response = await fetch(sse_post_url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(message),
			})
			if (!response.ok) {
				throw new Error(`SSE POST failed: ${response.status} ${response.statusText}`)
			}
		} catch (err) {
			console.error('Failed to send SSE message:', err)
			throw err
		}
		else {
			console.warn('MCP client not connected, cannot send message')
		}
	}

	/**
	 * 发送成功响应
	 * @param {number} id - 请求 ID
	 * @param {any} result - 响应结果
	 */
	async function sendResponse(id, result) {
		await sendMessage({
			jsonrpc: '2.0',
			id,
			result,
		})
	}

	/**
	 * 发送错误响应
	 * @param {number} id - 请求 ID
	 * @param {number} code - 错误代码
	 * @param {string} message - 错误消息
	 */
	async function sendErrorResponse(id, code, message) {
		await sendMessage({
			jsonrpc: '2.0',
			id,
			error: {
				code,
				message,
			},
		})
	}

	/**
	 * 发送 JSON-RPC 请求
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 * @returns {Promise<any>} 响应结果
	 */
	async function sendRequest(method, params = {}) {
		if (!mcp_process && !sse_client) await start()

		const id = ++messageId
		const request = {
			jsonrpc: '2.0',
			id,
			method,
			params,
		}

		const promise = new Promise((resolve, reject) => {
			pendingRequests.set(id, { resolve, reject })

			// 设置超时
			setTimeout(() => {
				if (pendingRequests.has(id)) {
					pendingRequests.delete(id)
					reject(new Error(`MCP request timeout: ${method}`))
				}
			}, 60000) // 60 秒超时
		})

		await sendMessage(request)

		return promise
	}

	/**
	 * 发送通知（不需要响应）
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 */
	async function sendNotification(method, params = {}) {
		if (!mcp_process && !sse_client) return

		await sendMessage({
			jsonrpc: '2.0',
			method,
			params,
		})
	}

	/**
	 * 初始化 MCP 连接
	 */
	async function initialize() {
		try {
			// 发送 initialize 请求
			const result = await sendRequest('initialize', {
				protocolVersion: '2024-11-05',
				capabilities: {
					roots: { listChanged: true },
					sampling: {},
				},
				clientInfo: {
					name: 'fount',
					version: '0.0.0',
				},
			})

			capabilities = result.capabilities
			serverInfo = result.serverInfo

			// 发送 initialized 通知
			await sendNotification('notifications/initialized')

			// 获取各种资源
			if (capabilities?.tools) {
				const toolsResult = await sendRequest('tools/list')
				tools = toolsResult.tools || []
			}

			if (capabilities?.prompts) {
				const promptsResult = await sendRequest('prompts/list')
				prompts = promptsResult.prompts || []
			}

			if (capabilities?.resources) {
				const resourcesResult = await sendRequest('resources/list')
				resources = resourcesResult.resources || []

				try {
					const templatesResult = await sendRequest('resources/templates/list')
					resourceTemplates = templatesResult.resourceTemplates || []
				} catch (err) {
					// 某些服务器可能不支持 templates
					console.warn('Resource templates not supported:', err.message)
				}
			}

			status = 'connected'
		} catch (err) {
			status = 'error'
			console.error('MCP initialization failed:', err)
			throw err
		}
	}

	/**
	 * 获取可用的工具列表
	 * @returns {Promise<Array>} 工具列表
	 */
	async function listTools() {
		if (status !== 'connected') await initialize()
		return tools
	}

	/**
	 * 调用 MCP 工具
	 * @param {string} toolName - 工具名称
	 * @param {object} args - 工具参数
	 * @returns {Promise<any>} 工具执行结果
	 */
	async function callTool(toolName, args) {
		if (status !== 'connected') await initialize()

		const result = await sendRequest('tools/call', {
			name: toolName,
			arguments: args || {},
		})

		return result
	}

	/**
	 * 获取可用的 prompt 列表
	 * @returns {Promise<Array>} prompt 列表
	 */
	async function listPrompts() {
		if (status !== 'connected') await initialize()
		return prompts
	}

	/**
	 * 获取 prompt
	 * @param {string} promptName - prompt 名称
	 * @param {object} args - prompt 参数
	 * @returns {Promise<any>} prompt 内容
	 */
	async function getPrompt(promptName, args) {
		if (status !== 'connected') await initialize()

		const result = await sendRequest('prompts/get', {
			name: promptName,
			arguments: args || {},
		})

		return result
	}

	/**
	 * 获取可用的资源列表
	 * @returns {Promise<Array>} 资源列表
	 */
	async function listResources() {
		if (status !== 'connected') await initialize()
		return resources
	}

	/**
	 * 读取资源
	 * @param {string} uri - 资源 URI
	 * @returns {Promise<any>} 资源内容
	 */
	async function readResource(uri) {
		if (status !== 'connected') await initialize()

		const result = await sendRequest('resources/read', {
			uri,
		})

		return result
	}

	/**
	 * 停止 MCP 客户端
	 */
	async function stop() {
		if (mcp_process) {
			try {
				mcp_process.kill('SIGTERM')
			} catch (err) {
				console.error('Error stopping MCP process:', err)
			}
			mcp_process = null
		}
		if (sse_client) {
			try {
				sse_client.close()
			} catch (err) {
				console.error('Error closing SSE connection:', err)
			}
			sse_client = null
			sse_post_url = null
		}
		status = 'stopped'
	}

	/**
	 * 获取服务器信息
	 * @returns {object} 服务器信息对象
	 */
	function getServerInfo() {
		return {
			status,
			capabilities,
			serverInfo,
			tools,
			prompts,
			resources,
			resourceTemplates,
			roots,
		}
	}

	/**
	 * 设置根目录列表
	 * @param {Array<string|object>} newRoots - 新的根目录列表
	 */
	async function setRoots(newRoots) {
		roots = newRoots || []
		// 通知服务器根目录已更改
		if ((mcp_process || sse_client) && status === 'connected')
			await sendNotification('notifications/roots/list_changed')

	}

	/**
	 * 添加根目录
	 * @param {string|object} root - 要添加的根目录
	 */
	async function addRoot(root) {
		if (!roots.find(r => (r.uri || r) === (root.uri || root))) {
			roots.push(root)
			if ((mcp_process || sse_client) && status === 'connected')
				await sendNotification('notifications/roots/list_changed')
		}
	}

	/**
	 * 删除根目录
	 * @param {string|object} root - 要删除的根目录
	 */
	async function removeRoot(root) {
		const rootId = root.uri || root
		roots = roots.filter(r => (r.uri || r) !== rootId)
		if ((mcp_process || sse_client) && status === 'connected')
			await sendNotification('notifications/roots/list_changed')

	}

	/**
	 * 获取当前根目录列表
	 * @returns {Array} 根目录列表
	 */
	function getRoots() {
		return roots
	}

	/**
	 * 设置 sampling handler
	 * @param {Function} handler - 新的 sampling handler
	 */
	function setSamplingHandler(handler) {
		samplingHandler = handler
	}

	/**
	 * 获取当前的 sampling handler
	 * @returns {Function|null} 当前的 sampling handler
	 */
	function getSamplingHandler() {
		return samplingHandler
	}

	return {
		start,
		stop,
		listTools,
		callTool,
		listPrompts,
		getPrompt,
		listResources,
		readResource,
		getServerInfo,
		setRoots,
		addRoot,
		removeRoot,
		getRoots,
		setSamplingHandler,
		getSamplingHandler,
	}
}
