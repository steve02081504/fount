import { setEndpoints } from './src/server/endpoints.mjs'
import { getPartData, setPartData } from './src/server/manager.mjs'

export default {
	info: {
		'': {
			name: 'config',
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
				const partType = args[1]
				const partName = args[2]

				if (!partType || !partName) throw new Error('Part type and name are required.')

				switch (action) {
					case 'get':
						console.log(await getPartData(user, partType, partName))
						break
					case 'set':
						const data = JSON.parse(args[3])
						await setPartData(user, partType, partName, data)
						console.log(`Config for ${partType} '${partName}' updated.`)
						break
					default:
						throw new Error(`Unknown action: ${action}. Available actions: get, set`)
				}
			},
			IPCInvokeHandler: async (user, { action, partType, partName, data }) => {
				if (!partType || !partName) throw new Error('Part type and name are required.')

				switch (action) {
					case 'get':
						return getPartData(user, partType, partName)
					case 'set':
						await setPartData(user, partType, partName, data)
						return `Config for ${partType} '${partName}' updated.`
					default:
						throw new Error(`Unknown action: ${action}. Available actions: get, set`)
				}
			}
		}
	}
}
