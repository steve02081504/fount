
import { on_shutdown } from './on_shutdown.mjs'

/** @type {Record<string, Record<string, import('../decl/charAPI.ts').charAPI_t>>} */
let charSet = {}
/** @type {Record<string, Record<string, import('../decl/charAPI.ts').charState_t>>} */
let userCharDataSet = {}
function loadCharData(username) {
	try {
		return userCharDataSet[username] ??= JSON.parse(fs.readFileSync(getUserDictionary(username) + '/char_data.json', 'utf8'))
	}
	catch (error) {
		return userCharDataSet[username] = {}
	}
}
function saveCharData(username) {
	fs.writeFileSync(getUserDictionary(username) + '/char_data.json', JSON.stringify(userCharDataSet[username], null, '\t'))
}

export async function LoadChar(username, charname) {
	charSet[username] ??= {}
	if (!charSet[username][charname]) {
		const char_dir = getUserDictionary(username) + '/chars/' + charname
		/** @type {import('../decl/charAPI.ts').charAPI_t} */
		const char = (await import(url.pathToFileURL(char_dir + '/main.mjs'))).default
		/** @type {import('../decl/charAPI.ts').charState_t} */
		let char_state = loadCharData(username)[charname].state
		const result = char.Load(char_state)
		if (result?.success) {
			charSet[username][charname] = char
			char_state.LastStart = Date.now()
			char_state.StartCount++
			saveCharData(username)
		}
		else throw new Error(result?.message)
	}
	return charSet[username][charname]
}

export function UnloadChar(username, charname, reason) {
	if (charSet[username]?.[charname]) {
		/** @type {import('../decl/charAPI.ts').charAPI_t} */
		const char = charSet[username][charname]
		char.Unload(reason)
		delete charSet[username][charname]
		saveCharData(username)
	}
}
on_shutdown(() => {
	for (let username in charSet)
		for (let charname in charSet[username])
			UnloadChar(username, charname, 'Server Shutdown')
})

export async function initChar(username, charname) {
	let char_dir = getUserDictionary(username) + '/chars/' + charname
	/** @type {import('../decl/charAPI.ts').charState_t} */
	const char_state = (loadCharData(username)[charname] ??= {
		/** @type {import('../decl/charAPI.ts').charState_t} */
		state: {
			InitCount: 0,
			LastStart: 0,
			StartCount: 0,
			memorys: {
				extension: {}
			}
		}
	}).state
	/** @type {import('../decl/charAPI.ts').charAPI_t} */
	const char = (await import(url.pathToFileURL(char_dir + '/main.mjs'))).default
	const result = char.Init(char_state)
	if (result?.success) saveCharData(username)
	else {
		fs.rmSync(char_dir, { recursive: true, force: true })
		throw new Error(result?.message)
	}
}

export async function uninstallChar(username, charname, reason, from) {
	let char_dir = getUserDictionary(username) + '/chars/' + charname
	/** @type {import('../decl/charAPI.ts').charAPI_t} */
	const char = await LoadChar(username, charname)
	char.Uninstall(reason, from)
	fs.rmSync(char_dir, { recursive: true, force: true })
}
