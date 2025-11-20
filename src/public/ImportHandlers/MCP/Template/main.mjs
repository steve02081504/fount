import fs from 'node:fs'
import path from 'node:path'

import { createMCPClient } from '../../../../../src/public/ImportHandlers/MCP/engine/mcp_client.mjs'
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { loadAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'

/** @typedef {import('../../../../../src/decl/pluginAPI.ts').pluginAPI_t} pluginAPI_t */

const pluginDir = import.meta.dirname
const dataPath = path.join(pluginDir, 'data.json')
let data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

let mcpClient = null
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
			world_prompt: { text: [] }, other_chars_prompt: {}, plugin_prompts: {}
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
			samplingAIsource = await loadAIsource(username, data.samplingAIsource)
		} catch (e) { console.warn('[MCP] Sampling load failed:', e) }

	mcpClient = await createMCPClient({
		...data.config,
		roots: data.roots || [],
		samplingHandler: samplingAIsource ? handleSampling : null
	})
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
	if (['array', 'object'].includes(type))  try { return JSON.parse(val) } catch { return val }
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
 * 解析 XML 调用
 * @param {string} content - 回复内容
 * @returns {Array<object>} 解析出的调用列表
 */
function parseCalls(content) {
	const calls = []
	/**
	 * 解析参数
	 * @param {string} body - XML 标签体
	 * @param {object} [schemaProps] - 参数 Schema
	 * @returns {object} 参数对象
	 */
	const parseParams = (body, schemaProps = {}) => {
		const args = {}
		const matches = [...body.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)]
		for (const [, key, val] of matches) args[key] = parseVal(val, schemaProps[key]?.type)
		return args
	}

	// 解析 Tool 和 Prompt
	for (const type of ['tool', 'prompt']) {
		const matches = [...content.matchAll(new RegExp(`<mcp-${type}\\s+name="([^"]+)">([\\s\\S]*?)<\\/mcp-${type}>`, 'g'))]
		for (const [fullMatch, name, body] of matches)
			// 此处不做严格 Schema 查找以保持无状态，运行时让 Server 校验
			calls.push({ type, name, args: parseParams(body), fullMatch })

	}
	// 解析 Resource
	for (const [fullMatch, uri] of content.matchAll(/<mcp-resource\s+uri="([^"]+)"\s*\/>/g))
		calls.push({ type: 'resource', uri, fullMatch })
	return calls
}

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
			: `<mcp-${type} name="...">\n  <param>val</param>\n</mcp-${type}>`
		return `## Available ${label}\n${list}\n**Usage:**\n\`\`\`xml\n${example}\n\`\`\`\n`
	}

	return [
		`# MCP Server: ${data.name}`,
		data.description || '',
		fmtItem(tools, 'tool', 'Tools'),
		fmtItem(prompts, 'prompt', 'Prompts'),
		resources.length ? `## Resources\n${resources.map(r => `- ${r.name}: \`${r.uri}\``).join('\n')}\nUse <mcp-resource uri="..."/>` : ''
	].join('\n\n')
}

/** @type {pluginAPI_t} */
export default {
	info: {
		'': {
			name: data?.name || 'mcp_plugin',
			avatar: data?.avatar || 'https://modelcontextprotocol.io/favicon.svg',
			description: data?.description || 'MCP Client',
			version: '1.0.0',
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
			 * @param {object} _arg - 上下文参数
			 * @returns {Promise<object>} Prompt 结构
			 */
			GetPrompt: async (_arg) => ({
				text: [{ content: await getDesc(), important: 0 }],
				additional_chat_log: [], extension: {}
			}),
			/**
			 * 处理回复
			 * @param {object} reply - 回复对象
			 * @param {object} args - 处理参数
			 * @returns {Promise<boolean>} 是否产生变更
			 */
			ReplyHandler: async (reply, args) => {
				if (!reply.content || !reply.content.includes('<mcp-')) return false
				const calls = parseCalls(reply.content)
				if (!calls.length) return false

				for (const call of calls)
					try {
						let result
						if (call.type === 'tool') result = await mcpClient.callTool(call.name, call.args)
						else if (call.type === 'prompt') result = await mcpClient.getPrompt(call.name, call.args)
						else result = await mcpClient.readResource(call.uri)

						args.AddLongTimeLog({
							role: 'tool',
							name: call.name || call.uri,
							content: `${call.type} result for ${call.name || call.uri}:\n\`\`\`\n${fmtRes(result)}\n\`\`\``
						})
					} catch (err) {
						console.error('MCP call error:', err)
						args.AddLongTimeLog({
							role: 'system',
							name: call.name || call.uri,
							content: `Error calling ${call.type} "${call.name || call.uri}": ${err.message}`
						})
					}

				return true
			}
		}
	}
}
