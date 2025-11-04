/**
 * MCP 客户端 - 通过 stdio 与 MCP 服务器通信
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
	let tools = []
	let isInitialized = false

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
		if (message.id && pendingRequests.has(message.id)) {
			const { resolve, reject } = pendingRequests.get(message.id)
			pendingRequests.delete(message.id)

			if (message.error) {
				reject(new Error(message.error.message || 'MCP request failed'))
			} else {
				resolve(message.result)
			}
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
			}, 30000) // 30 秒超时
		})

		const requestText = JSON.stringify(request) + '\n'
		const encoder = new TextEncoder()
		const writer = process.stdin.getWriter()
		await writer.write(encoder.encode(requestText))
		writer.releaseLock()

		return promise
	}

	/**
	 * 初始化 MCP 连接
	 */
	async function initialize() {
		try {
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

			if (result.capabilities?.tools) {
				const toolsResult = await sendRequest('tools/list')
				tools = toolsResult.tools || []
			}

			await sendRequest('initialized')
			isInitialized = true
		} catch (err) {
			console.error('MCP initialization failed:', err)
			throw err
		}
	}

	/**
	 * 获取可用的工具列表
	 * @returns {Promise<Array>} 工具列表
	 */
	async function listTools() {
		if (!isInitialized) await initialize()
		return tools
	}

	/**
	 * 调用 MCP 工具
	 * @param {string} toolName - 工具名称
	 * @param {object} args - 工具参数
	 * @returns {Promise<any>} 工具执行结果
	 */
	async function callTool(toolName, args) {
		if (!isInitialized) await initialize()
		
		const result = await sendRequest('tools/call', {
			name: toolName,
			arguments: args,
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
			isInitialized = false
		}
	}

	return {
		start,
		stop,
		listTools,
		callTool,
	}
}

