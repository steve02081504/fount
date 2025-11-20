import process from 'node:process'

import { Client } from 'npm:@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from 'npm:@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from 'npm:@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from 'npm:@modelcontextprotocol/sdk/client/websocket.js'
import { ListRootsRequestSchema, CreateMessageRequestSchema } from 'npm:@modelcontextprotocol/sdk/types.js'

/**
 * 创建并初始化 MCP 客户端
 * @param {object} config - MCP 配置对象
 * @param {string} [config.url] - SSE 模式下的服务器 URL
 * @param {string} [config.command] - Stdio 模式下的命令
 * @param {string[]} [config.args] - Stdio 模式下的参数
 * @param {object} [config.env] - Stdio 模式下的环境变量
 * @param {Array<string|object>} [config.roots] - 根目录列表
 * @param {Function} [config.samplingHandler] - 采样处理回调函数
 * @returns {Promise<object>} 封装后的客户端接口
 */
export async function createMCPClient(config) {
	const transport = config.url
		? config.url.startsWith('ws') ? new WebSocketClientTransport(new URL(config.url))
			: new StreamableHTTPClientTransport(new URL(config.url))
		: new StdioClientTransport({
			command: config.command,
			args: config.args || [],
			env: { ...process.env, ...config.env }
		})

	const client = new Client(
		{ name: 'fount-mcp-client', version: '1.0.0' },
		{ capabilities: { sampling: {}, roots: { listChanged: true } } }
	)

	if (config.roots)
		client.setRequestHandler(ListRootsRequestSchema, () => ({
			roots: config.roots.map(r => typeof r === 'string' ? { uri: r.startsWith('file:') ? r : `file://${r}`, name: r.split(/[/]/).pop() || r } : r)
		}))

	if (config.samplingHandler)
		client.setRequestHandler(CreateMessageRequestSchema, async (req) => ({
			role: 'assistant',
			content: { type: 'text', text: await config.samplingHandler(req.params) },
			model: 'default', stopReason: 'endTurn'
		}))

	try {
		await client.connect(transport)
	}
	catch (e) {
		if (config.url) {
			//may be using sse to connect
			const sseTransport = new SSEClientTransport(new URL(config.url))
			await client.connect(sseTransport)
		}
	}

	return {
		/**
		 * 获取底层 SDK 客户端实例
		 * @returns {Client} SDK Client 实例
		 */
		get rawClient() { return client },

		/**
		 * 停止客户端连接
		 * @returns {Promise<void>} Promise
		 */
		stop: () => client.close(),

		/**
		 * 获取工具列表
		 * @returns {Promise<Array>} 工具数组
		 */
		listTools: async () => (await client.listTools()).tools,

		/**
		 * 调用工具
		 * @param {string} name - 工具名称
		 * @param {object} [args] - 工具参数
		 * @returns {Promise<object>} 调用结果
		 */
		callTool: (name, args) => client.callTool({ name, arguments: args || {} }),

		/**
		 * 获取提示词列表
		 * @returns {Promise<Array>} 提示词数组
		 */
		listPrompts: async () => (await client.listPrompts()).prompts,

		/**
		 * 获取特定提示词
		 * @param {string} name - 提示词名称
		 * @param {object} [args] - 提示词参数
		 * @returns {Promise<object>} 提示词内容
		 */
		getPrompt: (name, args) => client.getPrompt({ name, arguments: args || {} }),

		/**
		 * 获取资源列表
		 * @returns {Promise<Array>} 资源数组
		 */
		listResources: async () => (await client.listResources()).resources,

		/**
		 * 读取资源内容
		 * @param {string} uri - 资源 URI
		 * @returns {Promise<object>} 资源内容
		 */
		readResource: (uri) => client.readResource({ uri }),

		/**
		 * 获取服务器信息
		 * @returns {object} 服务器能力和版本信息
		 */
		getServerInfo: () => ({
			capabilities: client.getServerCapabilities(),
			version: client.getServerVersion()
		}),

		/**
		 * 更新根目录列表并通知服务器
		 * @param {Array} newRoots - 新的根目录列表
		 * @returns {Promise<void>} Promise
		 */
		setRoots: async (newRoots) => {
			config.roots = newRoots
			await client.sendRootsListChanged()
		}
	}
}
