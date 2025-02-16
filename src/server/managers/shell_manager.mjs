import { PartsRouter } from '../server.mjs'
import { initPart, loadPartBase, uninstallPartBase, unloadPart } from '../parts_loader.mjs'

/**
 *
 * @param {string} username
 * @param {string} shellname
 * @returns {Promise<import('../../decl/shellAPI.ts').shellAPI_t>}
 */
export async function loadShell(username, shellname) {
	return loadPartBase(username, 'shells', shellname, PartsRouter)
}

export async function unloadShell(username, shellname) {
	await unloadPart(username, 'shells', shellname, PartsRouter)
}

export async function initShell(username, shellname) {
	await initPart(username, 'shells', shellname)
}

export async function uninstallShell(username, shellname) {
	await uninstallPartBase(username, 'shells', shellname)
}
