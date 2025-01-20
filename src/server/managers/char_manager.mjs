import { loadData, saveData } from '../setting_loader.mjs'
import { initPart, loadPartBase, uninstallPartBase, unloadPart } from '../parts_loader.mjs'

function loadCharData(username, charname) {
	let userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		/** @type {import('../../decl/charAPI.ts').charState_t} */
		state: {
			InitCount: 0,
			LastStart: 0,
			StartCount: 0,
		}
	}
}
function saveCharData(username) {
	saveData(username, 'char_data')
}

/**
 * @param {string} username
 * @param {string} charname
 * @returns {Promise<import('../../decl/charAPI.ts').charAPI_t>}
 */
export async function LoadChar(username, charname) {
	let data = loadCharData(username, charname)
	let char_state = data.state
	let char = await loadPartBase(username, 'chars', charname, {
		username,
		charname,
		state: char_state,
	})
	return char
}

export function UnloadChar(username, charname, reason) {
	unloadPart(username, 'chars', charname, reason)
	saveCharData(username)
}

export async function initChar(username, charname) {
	let state = loadCharData(username, charname).state
	await initPart(username, 'chars', charname, {
		username,
		charname,
		state,
	}, {
		afterInit: async (char) => {
			state.InitCount++
			saveCharData(username)
		}
	})
}

export async function uninstallChar(username, charname, reason, from) {
	await uninstallPartBase(username, 'chars', charname, { reason, from })
}
