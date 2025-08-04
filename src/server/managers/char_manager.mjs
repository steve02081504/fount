import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'
import { loadData, saveData } from '../setting_loader.mjs'

function loadCharData(username, charname) {
	const userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		/** @type {import('../../decl/charAPI.ts').charState_t} */
		state: {
			init_count: 0,
			last_start_time_stamp: 0,
			start_count: 0,
		}
	}
}
function saveCharData(username) {
	saveData(username, 'char_data')
}

/**
 * @param {string} username
 * @param {string} charname
 * @returns {Promise<import('../../decl/charAPI.ts').CharAPI_t>}
 */
export async function LoadChar(username, charname) {
	const data = loadCharData(username, charname)
	const char_state = data.state
	const char = await loadPartBase(username, 'chars', charname, {
		username,
		charname,
		state: char_state,
	}, {
		afterLoad: () => {
			char_state.last_start_time_stamp = Date.now()
			char_state.start_count++
		}
	})
	return char
}

export async function UnloadChar(username, charname, reason) {
	await unloadPartBase(username, 'chars', charname, reason)
	saveCharData(username)
}

export async function initChar(username, charname) {
	const { state } = loadCharData(username, charname)
	await initPart(username, 'chars', charname, {
		username,
		charname,
		state,
	}, {
		afterInit: async (char) => {
			state.init_count++
			saveCharData(username)
		}
	})
}

export async function uninstallChar(username, charname, reason, from) {
	await uninstallPartBase(username, 'chars', charname, { reason, from })
}
