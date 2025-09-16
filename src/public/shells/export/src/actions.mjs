import { exportPart } from './manager.mjs'

export const actions = {
	default: async ({ user, partType, partName, withData }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return exportPart(user, partType, partName, withData)
	}
}
