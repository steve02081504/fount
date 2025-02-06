import { loadData, saveData } from '../setting_loader.mjs'
import { initPart, loadPartBase, uninstallPartBase, unloadPart } from '../parts_loader.mjs'

function loadCharData(username, charname) {
	const userCharDataSet = loadData(username, 'char_data')
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
	const data = loadCharData(username, charname)
	const char_state = data.state
	const char = await loadPartBase(username, 'chars', charname, {
		username,
		charname,
		state: char_state,
	})
	return char
}

export async function UnloadChar(username, charname, reason) {
	await unloadPart(username, 'chars', charname, reason)
	saveCharData(username)
}

export async function initChar(username, charname) {
	const state = loadCharData(username, charname).state
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
