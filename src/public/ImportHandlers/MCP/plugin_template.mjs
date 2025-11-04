/**
 * 生成 MCP 插件模板
 * @param {string} serverName - MCP 服务器名称
 * @param {object} serverConfig - MCP 服务器配置
 * @returns {string} 插件代码
 */
export function generatePluginTemplate(serverName, serverConfig) {
	// 对配置进行 JSON 序列化，用于嵌入到生成的代码中
	const configJson = JSON.stringify(serverConfig, null, 2)
		.split('\n')
		.map((line, i) => i === 0 ? line : '\t' + line)
		.join('\n')

	return `import path from 'node:path'
import { loadJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { createMCPClient } from '../../../../../src/public/ImportHandlers/MCP/mcp_client.mjs'

/** @typedef {import('../../../../../src/decl/pluginAPI.ts').pluginAPI_t} pluginAPI_t */

const pluginDir = import.meta.dirname
const configPath = path.join(pluginDir, 'mcp_config.json')

let mcpClient = null
let tools = []

/**
 * 加载 MCP 配置并启动客户端
 */
async function initializeMCP() {
	try {
		const config = await loadJsonFile(configPath)
		mcpClient = createMCPClient(config)
		await mcpClient.start()
		tools = await mcpClient.listTools()
	} catch (err) {
		console.error('Failed to initialize MCP client for ${serverName}:', err)
		throw err
	}
}

/**
 * @type {pluginAPI_t}
 */
export default {
	info: {
		'': {
			name: 'mcp_${serverName}',
			avatar: '',
			description: 'MCP plugin for ${serverName}',
			description_markdown: 'MCP (Model Context Protocol) plugin for **${serverName}**. Provides tools: ' + (tools.length ? tools.map(t => \`\\\`\${t.name}\\\`\`).join(', ') : 'loading...'),
			version: '0.0.1',
			author: 'MCP Import',
			home_page: '',
			tags: ['mcp', 'tools', '${serverName}']
		}
	},

	Load: async () => {
		await initializeMCP()
	},

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
			 * @param {any} arg - 聊天回复请求
			 * @returns {Promise<import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t>}
			 */
			GetPrompt: async (arg) => {
				if (!tools.length) return { content: '' }

				const toolDescriptions = tools.map(tool => {
					const params = tool.inputSchema?.properties 
						? Object.entries(tool.inputSchema.properties).map(([name, schema]) => {
							const required = tool.inputSchema?.required?.includes(name) ? ' (required)' : ' (optional)'
							return \`  - \${name}\${required}: \${schema.description || schema.type}\`
						}).join('\\\\n')
						: '  No parameters'
					
					return \`## \${tool.name}
\${tool.description || 'No description'}

Parameters:
\${params}\`
				}).join('\\\\n\\\\n')

				return {
					content: \`# Available MCP Tools from ${serverName}

You have access to the following tools through the MCP (Model Context Protocol) server "${serverName}". You can call these tools by using the special command format in your response.

\${toolDescriptions}

To call a tool, use this format in your response:
\\\`\\\`\\\`mcp-call
{
  "tool": "tool_name_here",
  "args": {
    "param1": "value1",
    "param2": "value2"
  }
}
\\\`\\\`\\\`

The tool will be executed automatically and the result will be provided back to you.\`
				}
			},

			/**
			 * 处理角色的回复，检查是否有工具调用
			 * @param {import('../../../../../src/decl/prompt_struct.ts').chatLogEntry_t} reply - 聊天回复
			 * @param {any} args - 参数
			 * @returns {Promise<boolean>} true 表示需要重新生成回复
			 */
			ReplyHandler: async (reply, args) => {
				if (!reply.content) return false

				// 检查是否包含 MCP 工具调用
				const mcpCallRegex = /\\\`\\\`\\\`mcp-call\\\\s*([\\\\s\\\\S]*?)\\\`\\\`\\\`/g
				const matches = [...reply.content.matchAll(mcpCallRegex)]
				
				if (matches.length === 0) return false

				// 执行所有工具调用
				let hasChanges = false
				for (const match of matches) {
					try {
						const callData = JSON.parse(match[1])
						const { tool, args: toolArgs } = callData

						if (!tool) continue

						// 调用 MCP 工具
						const result = await mcpClient.callTool(tool, toolArgs)
						
						// 将结果添加到聊天记录中
						const resultText = typeof result === 'string' 
							? result 
							: JSON.stringify(result, null, 2)

						const toolResultEntry = {
							charname: 'system',
							content: \`Tool call result for \\\`\${tool}\\\`:
\\\`\\\`\\\`json
\${resultText}
\\\`\\\`\\\`\`,
							timestamp: Date.now()
						}

						if (args.AddLongTimeLog) {
							args.AddLongTimeLog(toolResultEntry)
						}

						hasChanges = true
					} catch (err) {
						console.error('MCP tool call failed:', err)
						
						const errorEntry = {
							charname: 'system',
							content: \`Tool call error: \${err.message}\`,
							timestamp: Date.now()
						}

						if (args.AddLongTimeLog) {
							args.AddLongTimeLog(errorEntry)
						}

						hasChanges = true
					}
				}

				// 如果有工具调用，需要重新生成回复以整合结果
				return hasChanges
			}
		}
	}
}
`
}

