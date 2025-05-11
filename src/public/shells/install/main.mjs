import { setEndpoints } from './src/server/endpoints.mjs'
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
	Load: (router) => {
		setEndpoints(router)
	},
	Unload: () => { },

	interfaces: {
		invokes: {
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
						throw error
					}
				}
				else if (action === 'uninstall') {
					const partType = args[1]
					const partName = args[2]
					await uninstallPartBase(user, partType, partName)
					console.log(`Uninstalled ${partType}: ${partName}`)
				} else
					throw 'Invalid action. Use "install" or "uninstall".'
			}
		}
	}
}
