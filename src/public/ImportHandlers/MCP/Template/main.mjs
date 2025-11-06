import fs from 'node:fs'
import path from 'node:path'
import { createMCPClient } from '../../../../../src/public/ImportHandlers/MCP/engine/mcp_client.mjs'
import { loadAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'
/** @typedef {import('../../../../../src/decl/pluginAPI.ts').pluginAPI_t} pluginAPI_t */
const pluginDir = import.meta.dirname
const dataPath = path.join(pluginDir, 'data.json')
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

let mcpClient = null
let serverInfo = null
let samplingAIsource = null
let username = null
/**
 * Sampling handler - 处理 MCP 服务器的 sampling 请求
 * @param {object} params - Sampling 参数
 * @returns {Promise<string>} 生成的文本
 */
async function handleSampling(params) {
	if (!samplingAIsource)
		throw new Error('Sampling AI source not configured')
	const { messages, maxTokens = 1000, temperature, systemPrompt } = params
	// 构建聊天历史
	const chatLog = messages.map(msg => ({
		name: msg.role === 'user' ? 'User' : 'Assistant',
		role: msg.role,
		content: msg.content?.text || msg.content || '',
		timestamp: Date.now()
	}))
	// 构建系统提示
	const systemPromptText = systemPrompt || 'You are a helpful assistant.'
	// 调用 AI 源生成响应
	try {
		const response = await samplingAIsource.Chat({
			system_prompt: systemPromptText,
			chat_log: chatLog,
			maxTokens,
			temperature
		})
		return response.content || response.text || String(response)
	} catch (err) {
		console.error('[MCP Sampling] AI call failed:', err)
		throw new Error(`Sampling failed: ${err.message}`)
	}
}
/**
 * 加载 MCP 配置并启动客户端
 */
async function initializeMCP() {
	try {
		// 如果配置了 sampling AI 源，加载它
		if (data.samplingAIsource && username)
			try {
				samplingAIsource = await loadAIsource(username, data.samplingAIsource)
				console.log(`[MCP][${data.name}] Sampling enabled with AI source: ${data.samplingAIsource}`)
			} catch (err) {
				console.warn(`[MCP][${data.name}] Failed to load sampling AI source:`, err)
			}
		// 合并配置和 roots
		const clientConfig = {
			...data.config,
			roots: data.roots || [],
			samplingHandler: samplingAIsource ? handleSampling : null
		}
		mcpClient = createMCPClient(clientConfig)
		await mcpClient.start()
		serverInfo = mcpClient.getServerInfo()
	} catch (err) {
		console.error(`Failed to initialize MCP plugin ${data?.name}:`, err)
		throw err
	}
}
/**
 * 格式化工具描述
 * @returns {string} 格式化的工具描述
 */
function formatToolsDescription() {
	if (!serverInfo?.tools?.length) return ''
	const toolDescriptions = serverInfo.tools.map(tool => {
		const params = tool.inputSchema?.properties
			? Object.entries(tool.inputSchema.properties).map(([name, schema]) => {
				const required = tool.inputSchema?.required?.includes(name) ? ' (required)' : ' (optional)'
				const type = schema.type || 'any'
				const desc = schema.description || 'No description'
				return `  - ${name}${required}: [${type}] ${desc}`
			}).join('\n')
			: '  No parameters'
		return `### ${tool.name}
${tool.description || 'No description'}
**Parameters:**
${params}`
	}).join('\n\n')
	return `## Available MCP Tools (Execute Actions)
${toolDescriptions}
**Usage:** To call a tool, use this XML format:
\`\`\`xml
<mcp-tool name="tool_name">
  <param1>value1</param1>
  <param2>value2</param2>
</mcp-tool>
\`\`\`
**Example:**
\`\`\`xml
<mcp-tool name="echo">
  <message>Hello World</message>
</mcp-tool>
\`\`\``
}
/**
 * 格式化 prompt 描述
 * @returns {string} 格式化的 prompt 描述
 */
function formatPromptsDescription() {
	if (!serverInfo?.prompts?.length) return ''
	const promptDescriptions = serverInfo.prompts.map(prompt => {
		const args = prompt.arguments?.length
			? prompt.arguments.map(arg => {
				const required = arg.required ? ' (required)' : ' (optional)'
				return `  - ${arg.name}${required}: ${arg.description || 'No description'}`
			}).join('\n')
			: '  No arguments'
		return `### ${prompt.name}
${prompt.description || 'No description'}
**Arguments:**
${args}`
	}).join('\n\n')
	return `## Available MCP Prompts (Get Templates)
⚠️ **Important:** Prompts are NOT tools! They are templates that return pre-defined content.
${promptDescriptions}
**Usage:** To get a prompt template, use this XML format (different from tools):
\`\`\`xml
<mcp-prompt name="prompt_name">
  <arg1>value1</arg1>
  <arg2>value2</arg2>
</mcp-prompt>
\`\`\`
**Example:**
\`\`\`xml
<mcp-prompt name="simple_prompt"/>
\`\`\``
}
/**
 * 格式化资源描述
 * @returns {string} 格式化的资源描述
 */
function formatResourcesDescription() {
	if (!serverInfo?.resources?.length) return ''
	const resourceDescriptions = serverInfo.resources.map(resource => {
		return `### ${resource.name}
URI: \`${resource.uri}\`
${resource.description || 'No description'}
MIME Type: ${resource.mimeType || 'unknown'}`
	}).join('\n\n')
	return `## Available MCP Resources (Read Data)
${resourceDescriptions}
**Usage:** To read a resource, use this XML format (different from tools and prompts):
\`\`\`xml
<mcp-resource uri="resource_uri"/>
\`\`\`
**Example:**
\`\`\`xml
<mcp-resource uri="test://static/resource/1"/>
\`\`\``
}
/**
 * 根据 schema 转换参数类型
 * @param {string} value - 字符串值
 * @param {object} schema - 参数的 schema 定义
 * @returns {any} 转换后的值
 */
function convertParamType(value, schema) {
	if (!schema || !schema.type) return value
	const trimmedValue = value.trim()
	switch (schema.type) {
		case 'number':
		case 'integer': {
			const num = Number(trimmedValue)
			return isNaN(num) ? trimmedValue : num
		}
		case 'boolean':
			if (trimmedValue === 'true') return true
			if (trimmedValue === 'false') return false
			return trimmedValue
		case 'array':
			try {
				const parsed = JSON.parse(trimmedValue)
				return Array.isArray(parsed) ? parsed : trimmedValue
			} catch {
				return trimmedValue
			}
		case 'object':
			try {
				const parsed = JSON.parse(trimmedValue)
				return typeof parsed === 'object' ? parsed : trimmedValue
			} catch {
				return trimmedValue
			}
		default:
			return trimmedValue
	}
}
/**
 * 解析 XML 工具调用
 * @param {string} content - 消息内容
 * @returns {Array} 解析出的调用
 */
function parseXMLCalls(content) {
	const calls = []
	// 解析 <mcp-tool>
	const toolRegex = /<mcp-tool\s+name="([^"]+)">([\s\S]*?)<\/mcp-tool>/g
	let match
	while ((match = toolRegex.exec(content)) !== null) {
		const [, name, body] = match
		const rawArgs = {}
		const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
		let paramMatch
		while ((paramMatch = paramRegex.exec(body)) !== null)
			rawArgs[paramMatch[1]] = paramMatch[2].trim()
		// 根据工具的 schema 转换参数类型
		const args = {}
		const tool = serverInfo?.tools?.find(t => t.name === name)
		if (tool?.inputSchema?.properties)
			for (const [key, value] of Object.entries(rawArgs)) {
				const schema = tool.inputSchema.properties[key]
				args[key] = convertParamType(value, schema)
			}
		else
			// 没有 schema，保持原样
			Object.assign(args, rawArgs)
		calls.push({ type: 'tool', name, args, fullMatch: match[0] })
	}
	// 解析 <mcp-prompt>
	const promptRegex = /<mcp-prompt\s+name="([^"]+)">([\s\S]*?)<\/mcp-prompt>/g
	while ((match = promptRegex.exec(content)) !== null) {
		const [, name, body] = match
		const rawArgs = {}
		const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
		let paramMatch
		while ((paramMatch = paramRegex.exec(body)) !== null)
			rawArgs[paramMatch[1]] = paramMatch[2].trim()
		// 根据 prompt 的 schema 转换参数类型
		const args = {}
		const prompt = serverInfo?.prompts?.find(p => p.name === name)
		if (prompt?.arguments)
			for (const [key, value] of Object.entries(rawArgs)) {
				const argDef = prompt.arguments.find(a => a.name === key)
				// Prompt arguments 可能没有详细的 type schema，暂时保持字符串
				args[key] = value
			}
		else
			Object.assign(args, rawArgs)
		calls.push({ type: 'prompt', name, args, fullMatch: match[0] })
	}
	// 解析 <mcp-resource>
	const resourceRegex = /<mcp-resource\s+uri="([^"]+)"\s*\/>/g
	while ((match = resourceRegex.exec(content)) !== null)
		calls.push({ type: 'resource', uri: match[1], fullMatch: match[0] })
	return calls
}
/**
 * 格式化工具调用结果
 * @param {any} result - MCP 返回结果
 * @returns {string} 格式化的结果
 */
function formatResult(result) {
	if (!result.content) return JSON.stringify(result, null, 2)
	return result.content.map(item => {
		if (item.type === 'text')
			return item.text
		else if (item.type === 'image')
			return `[Image: ${item.mimeType || 'image'}]`
		else if (item.type === 'resource')
			return `[Resource: ${item.uri}]`
		return JSON.stringify(item, null, 2)
	}).join('\n')
}
/**
 * @type {pluginAPI_t}
 */
export default {
	info: {
		'': {
			name: data?.name || 'mcp_plugin',
			avatar: '',
			description: data?.description || 'MCP plugin',
			description_markdown: data?.description_markdown || 'MCP (Model Context Protocol) plugin',
			version: '0.0.1',
			author: 'MCP Import Handler',
			home_page: '',
			tags: [...new Set(['mcp', 'tools', ...data?.tags || []])]
		}
	},
	/**
	 * 加载插件
	 * @param {object} stat - 加载状态信息，包含用户名。
	 */
	Load: async (stat) => {
		username = stat?.username
		await initializeMCP()
	},
	/**
	 * 卸载插件
	 */
	Unload: async () => {
		if (mcpClient) {
			await mcpClient.stop()
			mcpClient = null
		}
	},
	interfaces: {
		chat: {
			/**
			 * 为角色提供 MCP 工具的上下文
			 * @param {any} _arg - 聊天回复请求
			 * @returns {import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t} 返回给AI的prompt对象。
			 */
			GetPrompt: (_arg) => {
				if (!serverInfo)
					return {
						text: [],
						additional_chat_log: [],
						extension: {}
					}
				const sections = [
					`# MCP Server: ${data.name}`,
					data.description_markdown || data.description || '',
				]
				const toolsDesc = formatToolsDescription()
				if (toolsDesc) sections.push(toolsDesc)
				const promptsDesc = formatPromptsDescription()
				if (promptsDesc) sections.push(promptsDesc)
				const resourcesDesc = formatResourcesDescription()
				if (resourcesDesc) sections.push(resourcesDesc)
				return {
					text: [{
						content: sections.filter(s => s).join('\n\n'),
						important: 0
					}],
					additional_chat_log: [],
					extension: {}
				}
			},
			/**
			 * 处理角色的回复，检查是否有 MCP 调用
			 * @param {import('../../../../../src/decl/prompt_struct.ts').chatLogEntry_t} reply - 聊天回复
			 * @param {any} args - 参数
			 * @returns {Promise<boolean>} true 表示需要重新生成回复
			 */
			ReplyHandler: async (reply, args) => {
				if (!reply.content) return false
				const calls = parseXMLCalls(reply.content)
				if (calls.length === 0) return false
				let hasChanges = false
				for (const call of calls)
					try {
						let result
						let resultText = ''
						if (call.type === 'tool') {
							result = await mcpClient.callTool(call.name, call.args)
							resultText = `Tool call result for \`${call.name}\`:\n\`\`\`\n${formatResult(result)}\n\`\`\``
						} else if (call.type === 'prompt') {
							result = await mcpClient.getPrompt(call.name, call.args)
							resultText = `Prompt result for \`${call.name}\`:\n\`\`\`\n${formatResult(result)}\n\`\`\``
						} else if (call.type === 'resource') {
							result = await mcpClient.readResource(call.uri)
							resultText = `Resource content from \`${call.uri}\`:\n\`\`\`\n${formatResult(result)}\n\`\`\``
						}
						const resultEntry = {
							charname: 'system',
							content: resultText,
							timestamp: Date.now()
						}
						if (args.AddLongTimeLog)
							args.AddLongTimeLog(resultEntry)
						hasChanges = true
					} catch (err) {
						console.error(`MCP ${call.type} call failed:`, err)
						const errorEntry = {
							charname: 'system',
							content: `Error calling ${call.type} "${call.name || call.uri}": ${err.message}`,
							timestamp: Date.now()
						}
						if (args.AddLongTimeLog)
							args.AddLongTimeLog(errorEntry)
						hasChanges = true
					}
				return hasChanges
			}
		}
	}
}
