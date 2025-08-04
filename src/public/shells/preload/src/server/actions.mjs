import { loadPart } from '../../../../../server/managers/index.mjs'

export const actions = {
	default: ({ user, parttype, partname }) => {
		loadPart(user, parttype, partname)
	}
}
