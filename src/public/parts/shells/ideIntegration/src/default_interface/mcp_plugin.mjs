/**
 * 从 ACP McpServer 配置构建内存中的 fount 插件对象。
 * 逻辑与 ImportHandlers/MCP/Template 相同，但参数化（不依赖文件状态）。
 */
import { createMCPClient } from '../../../../ImportHandlers/MCP/engine/mcp_client.mjs'
import { defineToolUseBlocks } from '../../../../shells/chat/src/stream.mjs'

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
 * 解析回复中的 XML 工具调用。
 * @param {string} content - 回复文本。
 * @param {Array} tools - 已缓存的 MCP 工具列表。
 * @returns {Array<object>} 解析出的调用列表。
 */
function parseCalls(content, tools) {
	const calls = []
	/**
	 * 解析 XML 参数。
	 * @param {string} body - XML 主体。
	 * @param {object} schemaProps - JSON Schema 属性。
	 * @returns {object} 解析后的参数。
	 */
	const parseParams = (body, schemaProps = {}) => {
		const args = {}
		for (const [, key, value] of body.matchAll(/<([\w-]+)(?:\s+[^>]*)?>([\S\s]*?)<\/\1>/g))
			args[key] = parseValue(value, schemaProps[key]?.type)
		return args
	}

	for (const type of ['tool', 'prompt'])
		for (const [fullMatch, name, body] of content.matchAll(new RegExp(`<mcp-${type}\\s+name="([^"]+)">([\\s\\S]*?)<\\/mcp-${type}>`, 'g'))) {
			const toolDef = tools.find(t => t.name === name)
			calls.push({ type, name, args: parseParams(body, toolDef?.inputSchema?.properties || {}), fullMatch })
		}
	for (const [fullMatch, uri] of content.matchAll(/<mcp-resource\s+uri="([^"]+)"\s*\/>/g))
		calls.push({ type: 'resource', uri, fullMatch })
	return calls
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

	/**
	 * ReplyHandler 实现。
	 * @param {object} reply - 回复对象。
	 * @param {object} args - ReplyHandler 参数。
	 * @returns {Promise<boolean>} 是否处理了工具调用。
	 */
	async function ReplyHandler(reply, args) {
		if (!reply.content?.includes('<mcp-')) return false
		const calls = parseCalls(reply.content, tools)
		if (!calls.length) return false

		const acp = args?.extension?.acp ?? null
		const toolCallingLog = { name: reply.name, role: 'char', content: '', files: [] }
		let logAdded = false
		let callCounter = 0

		for (const call of calls) {
			toolCallingLog.content += call.fullMatch + '\n'
			if (!logAdded) {
				args.AddLongTimeLog(toolCallingLog)
				logAdded = true
			}

			const toolCallId = `mcp_${server.name}_${++callCounter}`
			const displayName = call.name || call.uri
			const kind = call.type === 'resource' ? 'read' : 'execute'

			if (acp)
				acp.connection.sessionUpdate({
					sessionId: acp.sessionId,
					update: { sessionUpdate: 'tool_call', toolCallId, title: `MCP ${call.type}: ${displayName}`, kind, status: 'in_progress' },
				})

			try {
				let callResult
				if (call.type === 'tool') callResult = await mcpClient.callTool(call.name, call.args)
				else if (call.type === 'prompt') callResult = await mcpClient.getPrompt(call.name, call.args)
				else callResult = await mcpClient.readResource(call.uri)

				const resultText = formatResult(callResult)
				if (acp)
					acp.connection.sessionUpdate({
						sessionId: acp.sessionId,
						update: {
							sessionUpdate: 'tool_call_update', toolCallId, status: 'completed',
							content: [{ type: 'content', content: { type: 'text', text: resultText } }],
							rawInput: call.args ?? { uri: call.uri },
							rawOutput: callResult,
						},
					})
				args.AddLongTimeLog({
					role: 'tool',
					name: displayName,
					content: `${call.type} result for ${displayName}:\n\`\`\`\n${resultText}\n\`\`\``,
					files: [],
				})
			} catch (error) {
				if (acp)
					acp.connection.sessionUpdate({
						sessionId: acp.sessionId,
						update: {
							sessionUpdate: 'tool_call_update', toolCallId, status: 'failed',
							content: [{ type: 'content', content: { type: 'text', text: error.message } }],
						},
					})
				args.AddLongTimeLog({
					role: 'system',
					name: displayName,
					content: `Error calling ${call.type} "${displayName}": ${error.message}`,
					files: [],
				})
			}
		}
		return true
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
				GetReplyPreviewUpdater: defineToolUseBlocks([
					{ start: /<mcp-tool[^>]*>/, end: '</mcp-tool>' },
					{ start: /<mcp-prompt[^>]*>/, end: '</mcp-prompt>' },
					{ start: /<mcp-resource[^>]*/, end: '>' },
				]),
				ReplyHandler,
			},
		},
	}

	return { client: mcpClient, plugin }
}
