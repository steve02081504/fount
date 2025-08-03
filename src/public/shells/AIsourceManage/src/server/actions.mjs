import { getPartList } from '../../../../../server/managers/index.mjs'
import { setDefaultPart } from '../../../../../server/parts_loader.mjs'
import { addAISourceFile, deleteAISourceFile, getAISourceFile, saveAISourceFile } from './manager.mjs'

export const actions = {
	list: ({ user }) => getPartList(user, 'AIsources'),
	create: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for create action.')
		await addAISourceFile(user, sourceName)
		return `AI source '${sourceName}' created.`
	},
	delete: async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for delete action.')
		await deleteAISourceFile(user, sourceName)
		return `AI source '${sourceName}' deleted.`
	},
	get: ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for get action.')
		return getAISourceFile(user, sourceName)
	},
	set: async ({ user, sourceName, config }) => {
		if (!sourceName) throw new Error('AI source name is required for set action.')
		await saveAISourceFile(user, sourceName, config)
		return `AI source '${sourceName}' updated.`
	},
	'set-default': async ({ user, sourceName }) => {
		if (!sourceName) throw new Error('AI source name is required for set-default action.')
		await setDefaultPart(user, 'AIsources', sourceName)
		return `AI source '${sourceName}' set as default.`
	}
}
