import { setEndpoints } from './src/server/endpoints.mjs'
import { addAISourceFile, deleteAISourceFile, getAISourceFile, saveAISourceFile } from './src/server/manager.mjs'
import { getPartList, setDefaultPart } from '../../../../server/parts_loader.mjs'

export default {
	info: {
		'': {
			name: 'AIsourceManage',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	Unload: () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				const sourceName = args[1]

				switch (action) {
					case 'list':
						console.log(await getPartList(user, 'AIsources'))
						break
					case 'create':
						if (!sourceName) throw new Error('AI source name is required for create action.')
						await addAISourceFile(user, sourceName)
						console.log(`AI source '${sourceName}' created.`)
						break
					case 'delete':
						if (!sourceName) throw new Error('AI source name is required for delete action.')
						await deleteAISourceFile(user, sourceName)
						console.log(`AI source '${sourceName}' deleted.`)
						break
					case 'get':
						if (!sourceName) throw new Error('AI source name is required for get action.')
						console.log(await getAISourceFile(user, sourceName))
						break
					case 'set':
						if (!sourceName) throw new Error('AI source name is required for set action.')
						const data = JSON.parse(args[2])
						await saveAISourceFile(user, sourceName, data)
						console.log(`AI source '${sourceName}' updated.`)
						break
					case 'set-default':
						if (!sourceName) throw new Error('AI source name is required for set-default action.')
						await setDefaultPart(user, 'AIsources', sourceName)
						console.log(`AI source '${sourceName}' set as default.`)
						break
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list, create, delete, get, set, set-default`)
				}
			},
			IPCInvokeHandler: async (user, data) => {
				const { action, sourceName, config } = data
				switch (action) {
					case 'list':
						return getPartList(user, 'AIsources')
					case 'create':
						if (!sourceName) throw new Error('AI source name is required for create action.')
						await addAISourceFile(user, sourceName)
						return `AI source '${sourceName}' created.`
					case 'delete':
						if (!sourceName) throw new Error('AI source name is required for delete action.')
						await deleteAISourceFile(user, sourceName)
						return `AI source '${sourceName}' deleted.`
					case 'get':
						if (!sourceName) throw new Error('AI source name is required for get action.')
						return getAISourceFile(user, sourceName)
					case 'set':
						if (!sourceName) throw new Error('AI source name is required for set action.')
						await saveAISourceFile(user, sourceName, config)
						return `AI source '${sourceName}' updated.`
					case 'set-default':
						if (!sourceName) throw new Error('AI source name is required for set-default action.')
						await setDefaultPart(user, 'AIsources', sourceName)
						return `AI source '${sourceName}' set as default.`
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list, create, delete, get, set, set-default`)
				}
			}
		}
	}
}
