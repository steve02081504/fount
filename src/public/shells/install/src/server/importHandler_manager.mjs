import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../../../../../server/parts_loader.mjs'

/**
 * @param {string} username
 * @param {string} tempname
 * @returns {Promise<import('../../../../../decl/importHandlerAPI.ts').importHandlerAPI_t>}
 */
export async function LoadImportHandler(username, tempname) {
	return await loadPartBase(username, 'ImportHandlers', tempname)
}

export async function UnloadImportHandler(username, tempname, reason) {
	await unloadPartBase(username, 'ImportHandlers', tempname, reason)
}

export async function initImportHandler(username, tempname) {
	await initPart(username, 'ImportHandlers', tempname)
}

export async function uninstallImportHandler(username, tempname) {
	await uninstallPartBase(username, 'ImportHandlers', tempname)
}
