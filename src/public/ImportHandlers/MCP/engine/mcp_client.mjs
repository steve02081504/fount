import { spawn } from 'node:child_process'
import process from 'node:process'
import { Client } from 'npm:@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from 'npm:@modelcontextprotocol/sdk/client/sse.js';
import { WebSocketClientTransport} from 'npm:@modelcontextprotocol/sdk/client/websocket.js'
import { StdioClientTransport} from 'npm:@modelcontextprotocol/sdk/client/stdio.js'

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
import { ListRootsRequestSchema, CreateMessageRequestSchema } from 'npm:@modelcontextprotocol/sdk/types.js';

export function createMCPClient(config) {
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
	let mcpClient = null

	/**
	 * 启动 MCP 服务器进程或连接
	 */
	async function start() {
		if (mcpClient) return

		if (config.url) { // SSE 模式
			await startSSE()
		} else if (config.command) { // Stdio 模式
			await startStdio()
		} else {
			throw new Error('Invalid MCP config: missing command or url')
		}
	}

	/**
	 * 注册请求处理器
	 */
	function registerRequestHandlers() {
		if (!mcpClient) return

		// 处理 roots/list 请求
		try{
			mcpClient.setRequestHandler(ListRootsRequestSchema, () => {
				return {
					roots: roots.map(root => {
						if (typeof root === 'string') {
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
			})
		}catch(e){
			console.warn('mcp do not support root/list')
		}

		// 处理 sampling/createMessage 请求
		mcpClient.setRequestHandler(CreateMessageRequestSchema, async (request) => {
			if (!samplingHandler) {
				throw new Error('Sampling not supported - no handler configured')
			}

			// 调用 sampling handler 并获取结果
			const samplingResult = await samplingHandler(request.params)

			// 格式化为 MCP 协议要求的格式
			return {
				role: 'assistant',
				content: {
					type: 'text',
					text: samplingResult
				},
				model: 'fount-sampling-model',
				stopReason: 'endTurn'
			}
		})
	}

	/**
	 * 启动 SSE 连接
	 */
	async function startSSE() {
		mcpClient = new Client({
			name: 'fount-mcp-client',
			version: '0.0.0'
		}, {
			capabilities: {
				prompts: {},
				resources: {},
				tools: {},
				sampling: {}
			}
		})


		let transport = null
		if (config.url.startsWith('ws')) {
			transport = new WebSocketClientTransport(new URL(config.url))
		} else {
			try {
				transport = new StreamableHTTPClientTransport(new URL(config.url))
			} catch (e) {
				transport = new SSEClientTransport(new URL(config.url))
			}
		}
		await mcpClient.connect(transport)
		const result = await mcpClient.listTools()
		tools = result.tools || []
		status = 'connected'
	}

	/**
	 * 启动 Stdio 进程
	 */
	async function startStdio() {
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args || [],
			env: {
				...process.env, ...config.env
			},
		})
		mcpClient = new Client({
			name: 'fount-mcp-client',
			version: '0.0.0'
		}, {
			capabilities: {
				prompts: {},
				resources: {},
				tools: {},
				sampling: {}
			}
		})


		await mcpClient.connect(transport)
		registerRequestHandlers()
		const result = await mcpClient.listTools()
		tools = result.tools || []
		status = 'connected'
	}




	/**
	 * 发送通知（不需要响应）
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 */
	async function sendNotification(method, params = {}) {
		if (!mcpClient) return

		await mcpClient.notification({
			method,
			params,
		})
	}

	/**
	 * 发送 JSON-RPC 请求
	 * @param {string} method - 方法名
	 * @param {object} [params] - 参数
	 * @returns {Promise<any>} 响应结果
	 */
	async function sendRequest(method, params = {}) {
		if (!mcpClient) await start()

		return await mcpClient.request({
			method,
			params
		}, /* resultSchema */ undefined)
	}

	/**
	 * 初始化 MCP 连接
	 */
	async function initialize() {
		if (!mcpClient) return
		try {
			// 获取各种资源
			const capabilities = mcpClient.getServerCapabilities()
			if (capabilities?.tools) {
				const toolsResult = await mcpClient.listTools()
				tools = toolsResult.tools || []
			}

			if (capabilities?.prompts) {
				const promptsResult = await mcpClient.listPrompts()
				prompts = promptsResult.prompts || []
			}

			if (capabilities?.resources) {
				const resourcesResult = await mcpClient.listResources()
				resources = resourcesResult.resources || []

				try {
					const templatesResult = await mcpClient.listResourceTemplates()
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
		if (mcpClient) {
			const result = await mcpClient.listTools()
			tools = result.tools || []
			return tools
		}
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

		if (mcpClient) {
			return await mcpClient.callTool({
				name: toolName,
				arguments: args || {},
			})
		}
		throw new Error('MCP client not connected')
	}

	/**
	 * 获取可用的 prompt 列表
	 * @returns {Promise<Array>} prompt 列表
	 */
	async function listPrompts() {
		if (status !== 'connected') await initialize()
		if (mcpClient) {
			const result = await mcpClient.listPrompts()
			prompts = result.prompts || []
			return prompts
		}
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

		if (mcpClient) {
			return await mcpClient.getPrompt({
				name: promptName,
				arguments: args || {},
			})
		}
		throw new Error('MCP client not connected')
	}

	/**
	 * 获取可用的资源列表
	 * @returns {Promise<Array>} 资源列表
	 */
	async function listResources() {
		if (status !== 'connected') await initialize()
		if (mcpClient) {
			const result = await mcpClient.listResources()
			resources = result.resources || []
			return resources
		}
		return resources
	}

	/**
	 * 读取资源
	 * @param {string} uri - 资源 URI
	 * @returns {Promise<any>} 资源内容
	 */
	async function readResource(uri) {
		if (status !== 'connected') await initialize()
		if (mcpClient) {
			return await mcpClient.readResource({
				uri,
			})
		}
		throw new Error('MCP client not connected')
	}

	/**
	 * 停止 MCP 客户端
	 */
	async function stop() {
		if (mcpClient) {
			try {
				mcpClient.close()
			} catch (err) {
				console.error('Error closing MCP connection:', err)
			}
			mcpClient = null
		}
		status = 'stopped'
	}

	/**
	 * 获取服务器信息
	 * @returns {object} 服务器信息对象
	 */
	function getServerInfo() {
		if (mcpClient) {
			const capabilities = mcpClient.getServerCapabilities()
			const serverInfo = mcpClient.getServerVersion()
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
		if (mcpClient && status === 'connected')
			await mcpClient.sendRootsListChanged()

	}

	/**
	 * 添加根目录
	 * @param {string|object} root - 要添加的根目录
	 */
	async function addRoot(root) {
		if (!roots.find(r => (r.uri || r) === (root.uri || root))) {
			roots.push(root)
			if (mcpClient && status === 'connected')
				await mcpClient.sendRootsListChanged()
		}
	}

	/**
	 * 删除根目录
	 * @param {string|object} root - 要删除的根目录
	 */
	async function removeRoot(root) {
		const rootId = root.uri || root
		roots = roots.filter(r => (r.uri || r) !== rootId)
		if (mcpClient && status === 'connected')
			await mcpClient.sendRootsListChanged()

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
		sendNotification,
	}
}
