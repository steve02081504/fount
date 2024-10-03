import { loadPart, uninstallPart, unloadPart } from './parts_loader.mjs'

export async function loadPersona(username, personaname) {
	loadPart(username, 'personas', personaname)
}

export function unloadPersona(username, personaname) {
	unloadPart(username, 'personas', personaname)
}

export async function uninstallPersona(username, personaname) {
	uninstallPart(username, 'personas', personaname)
}
