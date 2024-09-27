import fs from 'fs'
import { on_shutdown } from './on_shutdown.mjs'

/** @type {Record<string, Record<string, import('../decl/UserAPI.ts').UserAPI_t>>} */
let personas_set = {}

export async function loadPersona(username, personaname) {
	personas_set[username] ??= {}
	if (!personas_set[username][personaname]) {
		const personas_dir = getUserDictionary(username) + '/personas/' + personaname
		/** @type {import('../decl/UserAPI.ts').UserAPI_t} */
		const persona = (await import(personas_dir + '.mjs')).default
		const result = persona.Load()
		if (result.success) personas_set[username][personaname] = persona
		else throw new Error(result.message)
	}
	return personas_set[username][personaname]
}

export function unloadPersona(username, personaname) {
	if (personas_set[username]?.[personaname]) {
		/** @type {import('../decl/UserAPI.ts').UserAPI_t} */
		const persona = personas_set[username][personaname]
		persona.Unload()
		delete personas_set[username][personaname]
	}
}
on_shutdown(() => {
	for (let username in personas_set)
		for (let personaname in personas_set[username])
			unloadPersona(username, personaname)
})

export async function uninstallPersona(username, personaname) {
	const persona_dir = getUserDictionary(username) + '/personas/' + personaname
	const persona = await loadPersona(username, personaname)
	persona.Uninstall()
	fs.rmSync(getUserDictionary(username) + '/personas/' + personaname, { recursive: true, force: true })
}
