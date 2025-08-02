
import { setEndpoints } from './src/server/endpoints.mjs'
import { actions } from './actions.mjs'
import fs from 'node:fs/promises'

async function handleAction(user, params) {
	return actions.default({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'export',
			description: 'A shell to export fount parts.',
			version: '1.0.0',
			author: 'Gemini',
		},
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	Unload: () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const [partType, partName, withDataStr, outputPath] = args
				const withData = withDataStr === 'true'
				const params = { partType, partName, withData }

				const zipBuffer = await handleAction(user, params)
				const finalOutputPath = outputPath || `${partName}${withData ? '_with_data' : ''}.zip`
				await fs.writeFile(finalOutputPath, zipBuffer)
				console.log(`Part '${partName}' exported to ${finalOutputPath}`)
			},
			IPCInvokeHandler: async (user, data) => {
				return handleAction(user, data)
			}
		}
	}
}

