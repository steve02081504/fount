
import { setEndpoints } from './src/server/endpoints.mjs'
import { exportPart } from './src/server/manager.mjs'
import fs from 'node:fs/promises'

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
				const partType = args[0]
				const partName = args[1]
				const withData = args[2] === 'true'
				const outputPath = args[3]

				if (!partType || !partName) throw new Error('Part type and name are required.')

				const zipBuffer = await exportPart(user, partType, partName, withData)
				const finalOutputPath = outputPath || `${partName}${withData ? '_with_data' : ''}.zip`
				await fs.writeFile(finalOutputPath, zipBuffer)
				console.log(`Part '${partName}' exported to ${finalOutputPath}`)
			},
			IPCInvokeHandler: async (user, { partType, partName, withData }) => {
				if (!partType || !partName) throw new Error('Part type and name are required.')
				return exportPart(user, partType, partName, withData)
			}
		}
	}
}
