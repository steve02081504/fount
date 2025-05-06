import { loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

export async function loadPersona(username, personaname) {
	return loadPartBase(username, 'personas', personaname)
}

export async function unloadPersona(username, personaname) {
	await unloadPartBase(username, 'personas', personaname)
}

export async function uninstallPersona(username, personaname) {
	return uninstallPartBase(username, 'personas', personaname)
}
