import { initPart, loadPart, uninstallPart, unloadPart } from '../../../../../server/parts_loader.mjs'

/**
 * @param {string} username
 * @param {string} tempname
 * @returns {Promise<import('../../../../../decl/importHanlderAPI.ts').importHanlderAPI_t>}
 */
export async function LoadImportHanlder(username, tempname) {
	return await loadPart(username, 'ImportHanlders', tempname)
}

export function UnloadImportHanlder(username, tempname, reason) {
	unloadPart(username, 'ImportHanlders', tempname, reason)
}

export async function initImportHanlder(username, tempname) {
	await initPart(username, 'ImportHanlders', tempname)
}

export async function uninstallImportHanlder(username, tempname) {
	await uninstallPart(username, 'ImportHanlders', tempname)
}
