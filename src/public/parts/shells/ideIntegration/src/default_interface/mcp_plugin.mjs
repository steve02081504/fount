/**
 * 从 ACP McpServer 配置构建内存中的 fount 插件对象。
 * 逻辑与 ImportHandlers/MCP/Template 相同，但参数化（不依赖文件状态）。
 */
/**
 * @typedef {import('../../../../../../../src/decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t
 */
import { createMCPClient } from '../../../../ImportHandlers/MCP/engine/mcp_client.mjs'
import { defineReplyHandler, defineReplyHandlers } from '../../../chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../../chat/src/streaming/index.mjs'
import { sessionUpdate } from '../acp_agent.mjs'

/**
 * 将 ACP McpServer 配置转换为 createMCPClient 所需格式。
 * @param {object} server - ACP McpServer 对象（stdio / http / sse）。
 * @returns {object} createMCPClient 配置。
 */
function acpServerToConfig(server) {
	if (server.type === 'http' || server.type === 'sse')
		return { url: server.url }
	// stdio（ACP 中无 type 字段）
	const env = {}
	for (const { name, value } of server.env || []) env[name] = value
	return { command: server.command, args: server.args || [], env }
}

/**
 * 简易类型转换（从 XML 字符串值转为 JSON Schema 期望的类型）。
 * @param {string} value - 原始字符串值。
 * @param {string} [type] - JSON Schema 类型。
 * @returns {any} 转换后的值。
 */
const parseValue = (value, type) => {
	value = value.trim()
	if (!type) return value
	if (type === 'boolean') return value === 'true'
	if (['integer', 'number'].includes(type)) {
		const num = Number(value)
		return !Number.isNaN(num) ? num : value
	}
	if (['array', 'object'].includes(type)) try { return JSON.parse(value) } catch { return value }
	return value
}

/**
 * 格式化 MCP 调用结果内容为字符串。
 * @param {object} result - MCP 响应结果。
 * @returns {string} 格式化文本。
 */
const formatResult = (result) => result?.content?.map(item =>
	item.type === 'text' ? item.text : `[${item.type}: ${item.mimeType || item.uri || ''}]`
).join('\n') || JSON.stringify(result, null, 2)

/**
 * 按 JSON Schema 从内层子标签构建 MCP 参数。
 * @param {Array<{ tag: string, body: string }>} children - 内层子标签（body: 'children' 的解析结果）。
 * @param {Record<string, { type?: string }>} schemaProps - JSON Schema 属性表。
 * @returns {object} 类型化参数。
 */
function buildMCPArgs(children, schemaProps) {
	const callArgs = {}
	for (const child of children)
		callArgs[child.tag] = parseValue(child.body, schemaProps[child.tag]?.type)
	return callArgs
}

/**
 * 生成 MCP 服务器可用能力的描述文本。
 * @param {string} serverName - 服务器名称。
 * @param {object} mcpClient - 已连接的 MCP 客户端。
 * @returns {Promise<string>} 描述文本。
 */
async function getDesc(serverName, mcpClient) {
	const [tools, prompts, resources] = await Promise.all([
		mcpClient.listTools().catch(error => { console.error(`MCP ${serverName} listTools failed:`, error); return [] }),
		mcpClient.listPrompts().catch(error => { console.error(`MCP ${serverName} listPrompts failed:`, error); return [] }),
		mcpClient.listResources().catch(error => { console.error(`MCP ${serverName} listResources failed:`, error); return [] }),
	])

	/**
	 * 格式化 MCP 项目列表。
	 * @param {Array} items - 项目列表。
	 * @param {string} type - 类型。
	 * @param {string} label - 标签。
	 * @returns {string} 格式化后的文本。
	 */
	const formatItem = (items, type, label) => {
		if (!items?.length) return ''
		const list = items.map(item => {
			const args = (item.inputSchema?.properties ? Object.entries(item.inputSchema.properties) : item.arguments || [])
				.map(([key, schema]) => `  - ${key}: ${schema.description || ''}`).join('\n') || '  无参数'
			return `### ${item.name}\n${item.description || ''}\n**参数：**\n${args}`
		}).join('\n\n')
		const example = type === 'resource'
			? '<mcp-resource uri="..."/>'
			: `<mcp-${type} name="...">\n\t<param>val</param>\n</mcp-${type}>`
		return `\
## 可用${label}
${list}
用法：使用此 XML 格式调用：
${example}
${type === 'tool' ? `
示例：
<mcp-tool name="echo">
	<message>Hello World</message>
</mcp-tool>
` : type === 'prompt' ? `
示例：
<mcp-prompt name="get_user_info">
	<user_id>12345</user_id>
</mcp-prompt>
` : ''}`.trim()
	}

	return [
		`# MCP 服务器：${serverName}`,
		formatItem(tools, 'tool', '工具'),
		formatItem(prompts, 'prompt', '提示'),
		resources.length ? `\
## 资源
${resources.map(resource => `- ${resource.name}: \`${resource.uri}\``).join('\n')}
使用 <mcp-resource uri="..."/>
` : '',
	].filter(Boolean).join('\n\n')
}

/**
 * 从 ACP McpServer 配置构建一个内存中的 fount 插件。
 * 返回 { client, plugin }：client 用于生命周期管理，plugin 传入 GetReply 的 plugins。
 * @param {object} server - ACP McpServer 对象。
 * @param {{ cwd?: string }} [options] - 可选项（cwd 会作为 MCP root）。
 * @returns {Promise<{ client: object, plugin: object }>} MCP 客户端和插件。
 */
export async function buildMCPPlugin(server, { cwd } = {}) {
	const config = acpServerToConfig(server)
	if (cwd) config.roots = [cwd]

	const mcpClient = await createMCPClient(config)
	const tools = await mcpClient.listTools().catch(error => { console.error(`MCP ${server.name} listTools failed:`, error); return [] })

	let callCounter = 0

	/**
	 * 执行一次 MCP 调用：上报 ACP tool_call 状态并写入工具日志。
	 * @param {'tool'|'prompt'|'resource'} type - 调用类型。
	 * @param {string} name - 工具/提示名，或资源 URI。
	 * @param {object} callArgs - MCP 调用参数（资源为 null）。
	 * @param {object} args - 请求上下文。
	 * @returns {Promise<void>} 完成。
	 */
	async function runMCPCall(type, name, callArgs, args) {
		const acp = args?.extension?.acp ?? null
		const toolCallId = `mcp_${server.name}_${++callCounter}`
		const kind = type === 'resource' ? 'read' : 'execute'

		if (acp)
			sessionUpdate(acp.agentContext, {
				sessionId: acp.sessionId,
				update: { sessionUpdate: 'tool_call', toolCallId, title: `MCP ${type}: ${name}`, kind, status: 'in_progress' },
			})

		try {
			let callResult
			if (type === 'tool') callResult = await mcpClient.callTool(name, callArgs)
			else if (type === 'prompt') callResult = await mcpClient.getPrompt(name, callArgs)
			else callResult = await mcpClient.readResource(name)

			const resultText = formatResult(callResult)
			if (acp)
				sessionUpdate(acp.agentContext, {
					sessionId: acp.sessionId,
					update: {
						sessionUpdate: 'tool_call_update', toolCallId, status: 'completed',
						content: [{ type: 'content', content: { type: 'text', text: resultText } }],
						rawInput: type === 'resource' ? { uri: name } : callArgs,
						rawOutput: callResult,
					},
				})
			args.AddLongTimeLog({
				role: 'tool',
				name,
				content: `${type} result for ${name}:\n\`\`\`\n${resultText}\n\`\`\``,
				files: [],
			})
		}
		catch (error) {
			if (acp)
				sessionUpdate(acp.agentContext, {
					sessionId: acp.sessionId,
					update: {
						sessionUpdate: 'tool_call_update', toolCallId, status: 'failed',
						content: [{ type: 'content', content: { type: 'text', text: error.message } }],
					},
				})
			args.AddLongTimeLog({
				role: 'system',
				name,
				content: `Error calling ${type} "${name}": ${error.message}`,
				files: [],
			})
		}
	}

	/**
	 * `<mcp-tool name="...">`：调用 MCP 工具。
	 * @param {object} reply - 回复对象。
	 * @param {object} args - 请求上下文。
	 * @param {object} call - 调用对象。
	 * @returns {Promise<object>} 处理结果。
	 */
	async function handleMCPTool(reply, args, call) {
		const toolDef = tools.find(t => t.name === call.params.name)
		const callArgs = buildMCPArgs(call.body, toolDef?.inputSchema?.properties || {})
		await runMCPCall('tool', call.params.name, callArgs, args)
		return { regen: true }
	}

	/**
	 * `<mcp-prompt name="...">`：获取 MCP 提示。
	 * @param {object} reply - 回复对象。
	 * @param {object} args - 请求上下文。
	 * @param {object} call - 调用对象。
	 * @returns {Promise<object>} 处理结果。
	 */
	async function handleMCPPrompt(reply, args, call) {
		const promptDef = tools.find(t => t.name === call.params.name)
		const callArgs = buildMCPArgs(call.body, promptDef?.inputSchema?.properties || {})
		await runMCPCall('prompt', call.params.name, callArgs, args)
		return { regen: true }
	}

	/**
	 * `<mcp-resource uri="..." />`：读取 MCP 资源。
	 * @param {object} reply - 回复对象。
	 * @param {object} args - 请求上下文。
	 * @param {object} call - 调用对象。
	 * @returns {Promise<object>} 处理结果。
	 */
	async function handleMCPResource(reply, args, call) {
		await runMCPCall('resource', call.params.uri, null, args)
		return { regen: true }
	}

	/**
	 * MCP 标签的 ReplyHandler 组。
	 * @type {ReplyHandler_t[]}
	 */
	const replyHandlers = [
		defineReplyHandler({ tag: 'mcp-tool', params: { name: 'string' }, body: 'children', handle: handleMCPTool }),
		defineReplyHandler({ tag: 'mcp-prompt', params: { name: 'string' }, body: 'children', handle: handleMCPPrompt }),
		defineReplyHandler({ tag: 'mcp-resource', params: { uri: 'string' }, handle: handleMCPResource }),
	]

	/**
	 * GetPrompt 实现。
	 * @returns {Promise<object>} Prompt 数据。
	 */
	async function GetPrompt() {
		return {
			text: [{ content: await getDesc(server.name, mcpClient), important: 0 }],
			additional_chat_log: [],
			extension: {},
		}
	}

	const plugin = {
		info: {
			'': {
				name: `mcp_${server.name}`,
				avatar: 'https://modelcontextprotocol.io/favicon.svg',
				description: `MCP: ${server.name}`,
				version: '0.0.0',
				tags: ['mcp', server.name],
			},
		},
		interfaces: {
			chat: {
				GetPrompt,
				GetReplyPreviewUpdater: defineReplyPreviews(replyHandlers),
				ReplyHandler: defineReplyHandlers(replyHandlers),
			},
		},
	}

	return { client: mcpClient, plugin }
}
