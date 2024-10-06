import { loadData, saveData } from './setting_loader.mjs'
import { baseloadPart, initPart, loadPart, uninstallPart, unloadPart } from './parts_loader.mjs'
import { loadAIsource } from './AIsources_manager.mjs'

function loadCharData(username, charname) {
	let userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		/** @type {import('../decl/charAPI.ts').charState_t} */
		state: {
			InitCount: 0,
			LastStart: 0,
			StartCount: 0,
			AIsources: {},
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
	let data = loadCharData(username, charname)
	let char_state = data.state
	let char = await loadPart(username, 'chars', charname, char_state, {
		afterLoad: async (char) => {
			for (const sourceType in char_state.AIsources)
				char.SetAISource(await loadAIsource(username, char_state.AIsources[sourceType]), sourceType)
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

export async function setCharAIsource(username, charname, sourceType, sourcename) {
	let char = await LoadChar(username, charname)
	let AIsource = loadAIsource(username, sourcename)
	char.SetAISource(AIsource, sourceType)
	let char_state = loadCharData(username, charname).state
	char_state.AIsources[sourceType] = sourcename
	saveCharData(username)
}
