import { getPartData, setPartData } from './src/server/manager.mjs'

export const actions = {
	get: async ({ user, partType, partName }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return getPartData(user, partType, partName)
	},
	set: async ({ user, partType, partName, data }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		await setPartData(user, partType, partName, data)
		return `Config for ${partType} '${partName}' updated.`
	}
}
