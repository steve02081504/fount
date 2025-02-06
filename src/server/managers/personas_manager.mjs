import { loadPartBase, uninstallPartBase, unloadPart } from '../parts_loader.mjs'

export async function loadPersona(username, personaname) {
	return loadPartBase(username, 'personas', personaname)
}

export async function unloadPersona(username, personaname) {
	await unloadPart(username, 'personas', personaname)
}

export async function uninstallPersona(username, personaname) {
	return uninstallPartBase(username, 'personas', personaname)
}
