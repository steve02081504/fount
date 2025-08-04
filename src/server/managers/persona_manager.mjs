import { getDefaultParts, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

export async function loadPersona(username, personaname) {
	return loadPartBase(username, 'personas', personaname)
}

export async function unloadPersona(username, personaname) {
	await unloadPartBase(username, 'personas', personaname)
}

export async function uninstallPersona(username, personaname) {
	return uninstallPartBase(username, 'personas', personaname)
}

export async function loadDefaultPersona(username) {
	const defaultPersonaName = getDefaultParts(username).persona
	if (!defaultPersonaName) return
	return loadPersona(username, defaultPersonaName)
}
