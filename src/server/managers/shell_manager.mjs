import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 *
 * @param {string} username
 * @param {string} shellname
 * @returns {Promise<import('../../decl/shellAPI.ts').shellAPI_t>}
 */
export async function loadShell(username, shellname) {
	return loadPartBase(username, 'shells', shellname)
}

export async function unloadShell(username, shellname) {
	await unloadPartBase(username, 'shells', shellname)
}

export async function initShell(username, shellname) {
	await initPart(username, 'shells', shellname)
}

export async function uninstallShell(username, shellname) {
	await uninstallPartBase(username, 'shells', shellname)
}
