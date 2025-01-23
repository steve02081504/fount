import { setEndpoints, unsetEndpoints } from './src/server/endpoints.mjs'
import { importPart, importPartByText } from './src/server/Installer_handler.mjs'
import { uninstallPartBase } from '../../../server/parts_loader.mjs'
import fs from 'node:fs/promises'

export default {
	info: {
		'': {
			name: 'install',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: (app) => {
		setEndpoints(app)
	},
	Unload: (app) => {
		unsetEndpoints(app)
	},
	ArgumentsHandler: async (user, args) => {
		const action = args[0]

		if (action === 'install') {
			const input = args[1]
			try {
				// 检查输入是否为有效的文件路径
				try {
					const stats = await fs.stat(input)
					if (stats.isFile()) {
						const fileData = await fs.readFile(input)
						await importPart(user, fileData)
						console.log(`Installed from file: ${input}`)
					}
					else throw new Error('Input is not a valid file path')
				}
				catch (error) {
					await importPartByText(user, input)
					console.log(`Installed from text: ${input}`)
				}
			} catch (error) {
				console.error('Installation failed:', error)
			}
		}
		else if (action === 'uninstall') {
			const partType = args[1]
			const partName = args[2]
			await uninstallPartBase(user, partType, partName)
			console.log(`Uninstalled ${partType}: ${partName}`)
		} else
			console.error('Invalid action. Use "install" or "uninstall".')
	}
}
