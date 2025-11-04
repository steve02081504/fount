import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { move } from 'npm:fs-extra'

import { saveJsonFile } from '../../../scripts/json_loader.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'
import { getUserByUsername } from '../../../server/auth.mjs'

const templateDir = path.join(import.meta.dirname, 'Template')

/**
 * 复制模板文件夹到目标位置
 * @param {string} sourcePath - 源模板路径
 * @param {string} targetPath - 目标插件路径
 */
async function copyTemplate(sourcePath, targetPath) {
	// 确保目标目录存在
	await fs.promises.mkdir(targetPath, { recursive: true })
	
	// 复制所有文件
	const files = await fs.promises.readdir(sourcePath)
	for (const file of files) {
		const srcFile = path.join(sourcePath, file)
		const destFile = path.join(targetPath, file)
		const stat = await fs.promises.stat(srcFile)
		
		if (stat.isDirectory()) {
			await copyTemplate(srcFile, destFile)
		} else {
			await fs.promises.copyFile(srcFile, destFile)
		}
	}
}

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
			
			// 复制模板文件夹
			await copyTemplate(templateDir, pluginPath)
			
			// 创建插件数据
			const pluginData = {
				name: pluginName,
				description: `MCP plugin for ${serverName}`,
				description_markdown: `MCP (Model Context Protocol) plugin for **${serverName}**`,
				tags: [serverName, 'mcp'],
				config: serverConfig
			}
			
			// 保存 data.json
			await saveJsonFile(
				path.join(pluginPath, 'data.json'),
				pluginData
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
			version: '0.0.2',
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
