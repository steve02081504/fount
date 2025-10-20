import { loadPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 *
 * @param {*} username
 * @param {*} worldname
 * @returns {Promise<import('../../decl/worldAPI.ts').WorldAPI_t>}
 */
export function loadWorld(username, worldname) {
	return loadPartBase(username, 'worlds', worldname, {
		username,
		worldname,
	})
}

export async function unloadWorld(username, worldname) {
	await unloadPartBase(username, 'worlds', worldname)
}
