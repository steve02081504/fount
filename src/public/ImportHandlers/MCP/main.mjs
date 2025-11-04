import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { loadJsonFile, saveJsonFile } from '../../../scripts/json_loader.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'
import { getUserByUsername } from '../../../server/auth.mjs'

import { generatePluginTemplate } from './plugin_template.mjs'

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
		const user = getUserByUsername(username)
		const pluginsDir = path.join(user.path, 'plugins')
		
		// 确保 plugins 目录存在
		await fs.promises.mkdir(pluginsDir, { recursive: true })

		// 为每个 MCP 服务器创建一个插件
		for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
			const pluginName = `mcp_${serverName}`
			const pluginPath = path.join(pluginsDir, pluginName)
			
			// 创建插件目录
			await fs.promises.mkdir(pluginPath, { recursive: true })
			
			// 生成插件的 main.mjs 文件
			const pluginCode = generatePluginTemplate(serverName, serverConfig)
			await fs.promises.writeFile(
				path.join(pluginPath, 'main.mjs'),
				pluginCode,
				'utf-8'
			)
			
			// 保存 MCP 服务器配置
			await saveJsonFile(
				path.join(pluginPath, 'mcp_config.json'),
				serverConfig
			)
			
			// 如果插件已加载，重新加载它
			const needsReload = isPartLoaded(username, 'plugins', pluginName)
			if (needsReload) {
				await loadPart(username, 'plugins', pluginName)
			} else {
				// 预加载插件代码
				import(url.pathToFileURL(path.join(pluginPath, 'main.mjs'))).catch(x => x)
			}
			
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
		'': {
			name: 'MCP',
			avatar: '',
			description: 'Import MCP (Model Context Protocol) server configurations as plugins',
			description_markdown: 'Import MCP (Model Context Protocol) server configurations as individual plugins. Each MCP server becomes a separate plugin that can be enabled/disabled independently.',
			version: '0.0.1',
			author: 'fount',
			home_page: '',
			tags: ['mcp', 'tools', 'plugin-generator']
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}

