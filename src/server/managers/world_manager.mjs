import { loadPart } from "../parts_loader.mjs"

/**
 *
 * @param {*} username
 * @param {*} worldname
 * @returns {Promise<import('../../decl/worldAPI.ts').WorldAPI_t>}
 */
export function loadWorld(username, worldname) {
	return loadPart(username, 'worlds', worldname)
}
