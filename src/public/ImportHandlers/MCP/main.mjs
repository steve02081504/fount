import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

import { copy } from 'npm:fs-extra'

import { saveJsonFile } from '../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../server/auth.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'

const templateDir = path.join(import.meta.dirname, 'Template')

/**
 * 将 MCP 配置文件作为数据导入。
 * @param {string} username - 用户名。
 * @param {Buffer} data - 配置数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportAsData(username, data) {
	const configText = data.toString('utf-8')
	return await ImportByText(username, configText)
}

/**
 * 通过文本导入 MCP 配置。
 * @param {string} username - 用户名。
 * @param {string} text - MCP 配置的 JSON 文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	try {
		const config = JSON.parse(text)
		if (!config.mcpServers)
			throw new Error('Invalid MCP config: missing mcpServers')

		const installedParts = []
		const userPath = getUserDictionary(username)
		const pluginsDir = path.join(userPath, 'plugins')

		// 确保 plugins 目录存在
		await mkdir(pluginsDir, { recursive: true })

		// 为每个 MCP 服务器创建一个插件
		for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
			const pluginName = `mcp_${serverName}`
			const pluginPath = path.join(pluginsDir, pluginName)

			// 复制模板文件夹
			await copy(templateDir, pluginPath)

			// 提取特殊配置项
			const { roots, samplingAIsource, ...mcpConfig } = serverConfig

			// 创建插件数据
			const pluginData = {
				name: pluginName,
				description: `MCP plugin for ${serverName}`,
				description_markdown: `MCP (Model Context Protocol) plugin for **${serverName}**`,
				tags: [serverName, 'mcp'],
				config: mcpConfig
			}

			// 如果有 roots 配置，添加到 pluginData
			if (roots) pluginData.roots = roots

			// 如果有 samplingAIsource 配置，添加到 pluginData
			if (samplingAIsource) pluginData.samplingAIsource = samplingAIsource

			// 保存 data.json
			await saveJsonFile(
				path.join(pluginPath, 'data.json'),
				pluginData
			)

			// 如果插件已加载，重新加载它
			const needsReload = isPartLoaded(username, 'plugins', pluginName)
			if (needsReload)
				await loadPart(username, 'plugins', pluginName)
			else
				// 预加载插件代码
				import(url.pathToFileURL(path.join(pluginPath, 'main.mjs'))).catch(x => x)

			installedParts.push({ parttype: 'plugins', partname: pluginName })
		}

		return installedParts
	} catch (err) {
		throw new Error(`Failed to import MCP config: ${err.message || err}`)
	}
}

/**
 * MCP 导入器模块定义。
 */
export default {
	info: {
		'en-UK': {
			name: 'MCP Importer',
			avatar: '',
			description: 'Import MCP (Model Context Protocol) server configurations as plugins.',
			description_markdown: 'Import MCP (Model Context Protocol) server configurations as individual plugins. Each MCP server becomes a separate plugin that can be enabled/disabled independently.',
			version: '0.0.2',
			author: 'fount',
			home_page: '',
			tags: ['mcp', 'tools', 'plugin-generator']
		},
		'zh-CN': {
			name: 'MCP 导入器',
			avatar: '',
			description: '导入 MCP (模型上下文协议) 服务器配置作为插件。',
			description_markdown: '将 MCP (模型上下文协议) 服务器配置作为独立的插件导入。每个 MCP 服务器都会成为一个可以独立启用/禁用的独立插件。',
			version: '0.0.2',
			author: 'fount',
			home_page: '',
			tags: ['mcp', '工具', '插件生成器']
		},
		'zh-TW': {
			name: 'MCP 匯入器',
			avatar: '',
			description: '匯入 MCP (模型上下文協定) 伺服器設定為外掛程式。',
			description_markdown: '將 MCP (模型上下文協定) 伺服器設定作為獨立的外掛程式匯入。每個 MCP 伺服器都會成為一個可以獨立啟用/停用的獨立外掛程式。',
			version: '0.0.2',
			author: 'fount',
			home_page: '',
			tags: ['mcp', '工具', '外掛產生器']
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
