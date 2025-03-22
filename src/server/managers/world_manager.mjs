import { loadPartBase } from '../parts_loader.mjs'

/**
 *
 * @param {*} username
 * @param {*} worldname
 * @returns {Promise<import('../../decl/WorldAPI.ts').WorldAPI_t>}
 */
export function loadWorld(username, worldname) {
	return loadPartBase(username, 'worlds', worldname, {
		username,
		worldname,
	})
}
