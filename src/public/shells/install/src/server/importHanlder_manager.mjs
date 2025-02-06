import { initPart, loadPartBase, uninstallPartBase, unloadPart } from '../../../../../server/parts_loader.mjs'

/**
 * @param {string} username
 * @param {string} tempname
 * @returns {Promise<import('../../../../../decl/importHanlderAPI.ts').importHanlderAPI_t>}
 */
export async function LoadImportHanlder(username, tempname) {
	return await loadPartBase(username, 'ImportHanlders', tempname)
}

export async function UnloadImportHanlder(username, tempname, reason) {
	await unloadPart(username, 'ImportHanlders', tempname, reason)
}

export async function initImportHanlder(username, tempname) {
	await initPart(username, 'ImportHanlders', tempname)
}

export async function uninstallImportHanlder(username, tempname) {
	await uninstallPartBase(username, 'ImportHanlders', tempname)
}
