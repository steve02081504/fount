/**
 * MCP 客户端 - 参考 mcp.el 实现
 * 支持 stdio 连接方式，通过 JSON-RPC 2.0 与 MCP 服务器通信
 */

/**
 * 创建一个 MCP 客户端实例
 * @param {object} config - MCP 服务器配置
 * @param {string} config.command - 启动命令
 * @param {string[]} config.args - 命令参数
 * @param {Record<string, string>} [config.env] - 环境变量
 * @returns {object} MCP 客户端实例
 */
export function createMCPClient(config) {
	let process = null
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

	/**
	 * 启动 MCP 服务器进程
	 */
	async function start() {
		if (process) return

		const command = new Deno.Command(config.command, {
			args: config.args || [],
			env: { ...Deno.env.toObject(), ...config.env },
			stdin: 'piped',
			stdout: 'piped',
			stderr: 'piped',
		})

		process = command.spawn()

		// 处理 stdout 中的 JSON-RPC 消息
		const reader = process.stdout.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		// 异步读取和处理消息
		;(async () => {
			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
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
				}
			} catch (err) {
				console.error('MCP client read error:', err)
			}
		})()

		// 记录 stderr
		;(async () => {
			const stderrReader = process.stderr.getReader()
			const stderrDecoder = new TextDecoder()
			try {
				while (true) {
					const { done, value } = await stderrReader.read()
					if (done) break
					const text = stderrDecoder.decode(value, { stream: true })
					if (text.trim()) {
						console.error('MCP server stderr:', text)
					}
				}
			} catch (err) {
				console.error('MCP stderr read error:', err)
			}
		})()

		// 初始化连接
		await initialize()
	}

	/**
	 * 处理来自 MCP 服务器的消息
	 * @param {object} message - JSON-RPC 消息
	 */
	function handleMessage(message) {
		// 处理响应
		if (message.id && pendingRequests.has(message.id)) {
			const { resolve, reject } = pendingRequests.get(message.id)
			pendingRequests.delete(message.id)

			if (message.error) {
				reject(new Error(`[${message.error.code}] ${message.error.message || 'MCP request failed'}`))
			} else {
				resolve(message.result)
			}
		}
		
		// 处理通知
		if (message.method && !message.id) {
			handleNotification(message.method, message.params)
		}
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
	 * 发送 JSON-RPC 请求
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 * @returns {Promise<any>} 响应结果
	 */
	async function sendRequest(method, params = {}) {
		if (!process) await start()

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

		const requestText = JSON.stringify(request) + '\n'
		const encoder = new TextEncoder()
		const writer = process.stdin.getWriter()
		await writer.write(encoder.encode(requestText))
		writer.releaseLock()

		return promise
	}

	/**
	 * 发送通知（不需要响应）
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 */
	async function sendNotification(method, params = {}) {
		if (!process) return

		const notification = {
			jsonrpc: '2.0',
			method,
			params,
		}

		const notificationText = JSON.stringify(notification) + '\n'
		const encoder = new TextEncoder()
		const writer = process.stdin.getWriter()
		await writer.write(encoder.encode(notificationText))
		writer.releaseLock()
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
					version: '0.0.1',
				},
			})

			capabilities = result.capabilities
			serverInfo = result.serverInfo

			// 发送 initialized 通知
			await sendNotification('notifications/initialized')

			// 等待服务器完全初始化
			await new Promise(resolve => setTimeout(resolve, 2000))

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
		if (process) {
			try {
				process.kill('SIGTERM')
				await process.status
			} catch (err) {
				console.error('Error stopping MCP process:', err)
			}
			process = null
			status = 'stopped'
		}
	}

	/**
	 * 获取服务器信息
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
		}
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
	}
}
