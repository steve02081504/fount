
import { setEndpoints } from './src/server/endpoints.mjs'
import fs from 'node:fs/promises'

async function handleAction(user, action, params) {
	const { actions } = await import('./src/server/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
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

				const zipBuffer = await handleAction(user, 'default', params)
				const finalOutputPath = outputPath || `${partName}${withData ? '_with_data' : ''}.zip`
				await fs.writeFile(finalOutputPath, zipBuffer)
				console.log(`Part '${partName}' exported to ${finalOutputPath}`)
			},
			IPCInvokeHandler: async (user, data) => {
				return handleAction(user, 'default', data)
			}
		}
	}
}

