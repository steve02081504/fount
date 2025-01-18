import { loadPartBase, uninstallPartBase, unloadPart } from '../parts_loader.mjs'

export async function loadPersona(username, personaname) {
	loadPartBase(username, 'personas', personaname)
}

export function unloadPersona(username, personaname) {
	unloadPart(username, 'personas', personaname)
}

export async function uninstallPersona(username, personaname) {
	uninstallPartBase(username, 'personas', personaname)
}
