import { loadData, saveData } from './setting_loader.mjs'
import { baseloadPart, initPart, loadPart, uninstallPart, unloadPart } from './parts_loader.mjs'

function loadCharData(username, charname) {
	let userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		/** @type {import('../decl/charAPI.ts').charState_t} */
		state: {
			InitCount: 0,
			LastStart: 0,
			StartCount: 0,
			memorys: {
				extension: {}
			}
		}
	}
}
function saveCharData(username) {
	saveData(username, 'char_data')
}

export async function getCharDetails(username, charname) {
	const char = await baseloadPart(username, 'chars', charname)
	return {
		name: char.name,
		avatar: char.avatar,
		description: char.description,
		description_markdown: char.description_markdown,
		version: char.version,
		author: char.author,
		homepage: char.homepage,
		tags: char.tags
	}
}

export async function LoadChar(username, charname) {
	let char_state = loadCharData(username, charname).state
	let char = await loadPart(username, 'chars', charname, char_state, {
		afterLoad: async (char) => {
			char_state.LastStart = Date.now()
			char_state.StartCount++
			saveCharData(username)
		}
	})
	return char
}

export function UnloadChar(username, charname, reason) {
	unloadPart(username, 'chars', charname, reason)
	saveCharData(username)
}

export async function initChar(username, charname) {
	let state = loadCharData(username, charname).state
	await initPart(username, 'chars', charname, state, {
		afterInit: async (char) => {
			state.InitCount++
			saveCharData(username)
		}
	})
}

export async function uninstallChar(username, charname, reason, from) {
	await uninstallPart(username, 'chars', charname, { reason, from })
}
