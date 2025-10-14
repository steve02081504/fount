import { runPet, stopPet, getPetList, getRunningPetList } from './pet_runner.mjs'

export const actions = {
	list: ({ user }) => getPetList(user),
	'list-running': ({ user }) => getRunningPetList(user),
	start: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for start action.')
		await runPet(user, charname)
		return `Pet '${charname}' started.`
	},
	stop: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for stop action.')
		await stopPet(user, charname)
		return `Pet '${charname}' stopped.`
	}
}
