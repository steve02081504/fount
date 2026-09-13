import fs from 'node:fs'
import path from 'node:path'

import { createMCPClient } from 'fount/public/parts/ImportHandlers/MCP/engine/mcp_client.mjs'
import { defineReplyHandler, defineReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from 'fount/public/parts/shells/chat/src/streaming/replyPreviews.mjs'
import { saveJsonFile } from 'fount/scripts/json_loader.mjs'
import { loadPart } from 'fount/server/parts_loader.mjs'

/**
 * 插件 API 类型别名。
 * @typedef {import('../../../../../src/decl/pluginAPI.ts').pluginAPI_t} pluginAPI_t
 */
/**
 * 回复处理器类型别名。
 * @typedef {import('../../../../../src/decl/pluginAPI.ts').ReplyHandler_t} ReplyHandler_t
 */

const pluginDir = import.meta.dirname
const dataPath = path.join(pluginDir, 'data.json')
let data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

let mcpClient = null
let tools = null
let samplingAIsource = null
let username = null

/**
 * Sampling 处理器
 * @param {object} params - Sampling 参数对象
 * @param {Array} params.messages - 消息历史
 * @param {string} [params.systemPrompt] - 系统提示词
 * @returns {Promise<string>} AI 生成的文本
 */
const handleSampling = async ({ messages, systemPrompt }) => {
	if (!samplingAIsource) throw new Error('Sampling source not configured')
	const chat_log = [
		...systemPrompt ? [{ role: 'system', content: systemPrompt }] : [],
		...messages.map(m => ({
			role: m.role === 'user' ? 'user' : m.role === 'assistant' ? 'char' : 'system',
			content: m.content?.text || m.content || ''
		}))
	]
	try {
		const res = await samplingAIsource.StructCall({
			chat_log, user_prompt: { text: [] }, char_prompt: { text: [] },
			world_prompt: { text: [] }, other_chars_prompts: {}, other_personas_prompts: {}, plugin_prompts: {}
		})
		return res.content
	} catch (err) {
		console.error('[MCP Sampling] Failed:', err)
		throw err
	}
}

/**
 * 初始化 MCP 客户端
 * @returns {Promise<void>} 无返回值
 */
async function initializeMCP() {
	if (data.samplingAIsource && username && !samplingAIsource)
		try {
			samplingAIsource = await loadPart(username, 'serviceSources/AI/' + data.samplingAIsource)
		} catch (e) { console.warn('[MCP] Sampling load failed:', e) }

	mcpClient = await createMCPClient({
		...data.config,
		roots: data.roots || [],
		samplingHandler: samplingAIsource ? handleSampling : null
	})
	tools = await mcpClient.listTools()
}

/**
 * 简易类型转换
 * @param {string} val - 原始字符串值
 * @param {string} [type] - 目标类型
 * @returns {any} 转换后的值
 */
const parseVal = (val, type) => {
	val = val.trim()
	if (!type) return val
	if (type === 'boolean') return val === 'true'
	if (['integer', 'number'].includes(type)) { const num = Number(val); return !Number.isNaN(num) ? num : val }
	if (['array', 'object'].includes(type)) try { return JSON.parse(val) } catch { return val }
	return val
}

/**
 * 格式化结果内容
 * @param {object} res - MCP 响应结果
 * @returns {string} 格式化后的字符串
 */
const fmtRes = (res) => res?.content?.map(i =>
	i.type === 'text' ? i.text : `[${i.type}: ${i.mimeType || i.uri || ''}]`
).join('\n') || JSON.stringify(res, null, 2)

/**
 * 把 MCP 调用的内层子标签解析为参数对象（按 Schema 类型转换）。
 * @param {Array<{ tag: string, body: string }>} children - 子标签列表
 * @param {Record<string, { type?: string }>} [schemaProps] - 参数 Schema
 * @returns {object} 参数对象
 */
function parseMcpArgs(children, schemaProps = {}) {
	const args = {}
	for (const child of children)
		args[child.tag] = parseVal(child.body, schemaProps[child.tag]?.type)
	return args
}

/**
 * 执行一次 MCP 调用并把结果或错误写入长期日志。
 * @param {object} args - 请求上下文
 * @param {string} type - 调用类型（tool/prompt/resource）
 * @param {string} name - 工具/提示名或资源 URI
 * @param {() => Promise<object>} invoke - 实际调用
 * @returns {Promise<void>} Promise
 */
async function runMcpCall(args, type, name, invoke) {
	try {
		const result = await invoke()
		args.AddLongTimeLog({
			role: 'tool',
			name,
			content: `${type} result for ${name}:\n\`\`\`\n${fmtRes(result)}\n\`\`\``,
			files: []
		})
	} catch (err) {
		console.error('MCP call error:', err)
		args.AddLongTimeLog({
			role: 'system',
			name,
			content: `Error calling ${type} "${name}": ${err.message}`,
			files: []
		})
	}
}

/**
 * `<mcp-tool name="...">`：调用 MCP 工具。
 * @type {ReplyHandler_t}
 */
export const mcpToolReplyHandler = defineReplyHandler({
	tag: 'mcp-tool',
	body: 'children',
	/**
	 * 调用 MCP 工具。
	 * @param {object} reply - 回复对象
	 * @param {object} args - 请求上下文
	 * @param {object} call - 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const name = call.params.name
		const schemaProps = tools.find(t => t.name === name)?.inputSchema?.properties || {}
		await runMcpCall(args, 'tool', name, () => mcpClient.callTool(name, parseMcpArgs(call.body, schemaProps)))
		return { regen: true }
	},
})

/**
 * `<mcp-prompt name="...">`：获取 MCP 提示。
 * @type {ReplyHandler_t}
 */
export const mcpPromptReplyHandler = defineReplyHandler({
	tag: 'mcp-prompt',
	body: 'children',
	/**
	 * 获取 MCP 提示。
	 * @param {object} reply - 回复对象
	 * @param {object} args - 请求上下文
	 * @param {object} call - 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const name = call.params.name
		const schemaProps = tools.find(t => t.name === name)?.inputSchema?.properties || {}
		await runMcpCall(args, 'prompt', name, () => mcpClient.getPrompt(name, parseMcpArgs(call.body, schemaProps)))
		return { regen: true }
	},
})

/**
 * `<mcp-resource uri="..."/>`：读取 MCP 资源。
 * @type {ReplyHandler_t}
 */
export const mcpResourceReplyHandler = defineReplyHandler({
	tag: 'mcp-resource',
	/**
	 * 读取 MCP 资源。
	 * @param {object} reply - 回复对象
	 * @param {object} args - 请求上下文
	 * @param {object} call - 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const uri = call.params.uri
		await runMcpCall(args, 'resource', uri, () => mcpClient.readResource(uri))
		return { regen: true }
	},
})

/**
 * MCP 插件的全部 ReplyHandler。
 * @type {ReplyHandler_t[]}
 */
export const mcpReplyHandlers = [
	mcpToolReplyHandler,
	mcpPromptReplyHandler,
	mcpResourceReplyHandler,
]

/**
 * 生成描述文本
 * @returns {Promise<string>} 描述文本
 */
const getDesc = async () => {
	if (!mcpClient) return ''
	const [tools, prompts, resources] = await Promise.all([
		mcpClient.listTools().catch(() => []),
		mcpClient.listPrompts().catch(() => []),
		mcpClient.listResources().catch(() => [])
	])

	/**
	 * 格式化项目列表
	 * @param {Array} items - 项目数组
	 * @param {string} type - 类型名称
	 * @param {string} label - 显示标签
	 * @returns {string} 格式化后的文本
	 */
	const fmtItem = (items, type, label) => {
		if (!items?.length) return ''
		const list = items.map(i => {
			const args = (i.inputSchema?.properties ? Object.entries(i.inputSchema.properties) : i.arguments || [])
				.map(([k, v]) => `  - ${k}: ${v.description || ''}`).join('\n') || '  No params'
			return `### ${i.name}\n${i.description || ''}\n**Params:**\n${args}`
		}).join('\n\n')
		const example = type === 'resource'
			? '<mcp-resource uri="..."/>'
			: `<mcp-${type} name="...">\n\t<param>val</param>\n</mcp-${type}>`
		return `\
## Available ${label}
${list}
Usage: To call a tool, use this XML format:
${example}
${type === 'tool' ? `
Example:
<mcp-tool name="echo">
	<message>Hello World</message>
</mcp-tool>
` : type === 'prompt' ? `
Example:
<mcp-prompt name="get_user_info">
	<user_id>12345</user_id>
</mcp-prompt>
` : ''}`.trim()
	}

	return [
		`# MCP Server: ${data.name}`,
		data.description || '',
		fmtItem(tools, 'tool', 'Tools'),
		fmtItem(prompts, 'prompt', 'Prompts'),
		resources.length ? `\
## Resources
${resources.map(r => `- ${r.name}: \`${r.uri}\``).join('\n')}
Use <mcp-resource uri="..."/>
` : ''].join('\n\n')
}

/**
 * MCP 插件默认导出对象。
 * @type {pluginAPI_t}
 */
export default {
	info: {
		'': {
			name: data?.name || 'mcp_plugin',
			avatar: data?.avatar || 'https://modelcontextprotocol.io/favicon.svg',
			description: data?.description || 'MCP Client',
			version: data?.version || '0.0.0',
			tags: ['mcp', ...data?.tags || []]
		}
	},
	/**
	 * 加载插件
	 * @param {object} stat - 状态对象
	 * @returns {Promise<void>} Promise
	 */
	Load: async (stat) => { username = stat?.username; await initializeMCP() },
	/**
	 * 卸载插件
	 * @returns {Promise<void>} Promise
	 */
	Unload: async () => { await mcpClient?.stop(); mcpClient = null },
	interfaces: {
		config: {
			/**
			 * 获取配置
			 * @returns {object} 配置对象
			 */
			GetData: () => data,
			/**
			 * 设置配置
			 * @param {object} newData - 新配置
			 * @returns {Promise<void>} Promise
			 */
			SetData: async (newData) => {
				if (!Object.keys(newData).length) return
				data = newData
				saveJsonFile(dataPath, data)
				await mcpClient?.stop()
				mcpClient = null
				await initializeMCP()
			}
		},
		chat: {
			/**
			 * 获取 Prompt
			 * @param {object} args - 上下文参数
			 * @returns {Promise<object>} Prompt 结构
			 */
			GetPrompt: async (args) => ({
				text: [{ content: await getDesc(args), important: 0 }],
				additional_chat_log: [], extension: {}
			}),
			GetReplyPreviewUpdater: defineReplyPreviews(mcpReplyHandlers),
			ReplyHandler: defineReplyHandlers(mcpReplyHandlers),
		}
	}
}
