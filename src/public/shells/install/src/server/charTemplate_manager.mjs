import { initPart, loadPart, uninstallPart, unloadPart } from '../../../../../server/parts_loader.mjs'

/**
 * @param {string} username
 * @param {string} tempname
 * @returns {Promise<import('../../../../../decl/charTemplateAPI.ts').charTemplateAPI_t>}
 */
export async function LoadCharTemplate(username, tempname) {
	return await loadPart(username, 'charTemplates', tempname)
}

export function UnloadCharTemplate(username, tempname, reason) {
	unloadPart(username, 'charTemplates', tempname, reason)
}

export async function initCharTemplate(username, tempname) {
	await initPart(username, 'charTemplates', tempname)
}

export async function uninstallCharTemplate(username, tempname) {
	await uninstallPart(username, 'charTemplates', tempname)
}
