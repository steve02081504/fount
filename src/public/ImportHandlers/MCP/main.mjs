
import fs from 'npm:fs-extra'
import path from 'node:path'
import sanitizeFilename from 'npm:sanitize-filename'
import { getAvailablePath } from '../../../server/parts_paths.mjs'
import { saveJsonFile } from '../../../scripts/loadJsonFile.js'
import info from './info.json' assert { type: 'json' }

/**
 * @typedef {import('../../../decl/import.ts').import_handler_t} import_handler_t
 */

/**
 * 通过文本导入 MCP 服务器配置。
 * @param {string} username - 用户名。
 * @param {string} text - 包含 MCP 服务器配置的 JSON 字符串。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	const servers = JSON.parse(text)
	const importedPlugins = []

	for (const server of servers) {
		const pluginName = sanitizeFilename(`mcp-${server.name}`)
		const targetPath = await getAvailablePath(username, 'plugins', pluginName)

		const pluginData = {
			main: ``,
			'plugin.json': {
				info: {
					'en-UK': {
						name: server.name,
						avatar: server.icon || 'https://modelcontextprotocol.io/favicon.svg',
						description: server.description || `MCP server: ${server.name}`,
						version: '0.0.0',
						author: 'MCP Importer',
						tags: ['mcp', 'tools']
					}
				},
				'main.mjs': `export default {
					info: {
						'en-UK': {
							name: '${server.name}',
							avatar: '${server.icon || 'https://modelcontextprotocol.io/favicon.svg'}',
							description: '${server.description || `MCP server: ${server.name}`}',
							version: '0.0.0',
							author: 'MCP Importer',
							tags: ['mcp', 'tools']
						}
					},
					interfaces: {
						plugins: {
							GetTools: () => (${JSON.stringify(server.tools, null, 2)})
						}
					}
				}`
			}
		}

		await fs.ensureDir(targetPath)
		await fs.writeFile(path.join(targetPath, 'main.mjs'), pluginData['plugin.json']['main.mjs'])
		saveJsonFile(path.join(targetPath, 'plugin.json'), pluginData['plugin.json'])

		importedPlugins.push({ parttype: 'plugins', partname: pluginName })
	}

	return importedPlugins
}


/**
 * @type {import('../../../decl/import.ts').import_handler_t}
 */
export default {
	info,
	interfaces: {
		import: {
			ImportByText,
		}
	}
}
