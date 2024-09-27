import fs from 'fs'

/** @type {Record<string, Record<string, import('../decl/AIsource.ts').AIsource_t>>} */
let AIsources_set = {}
export async function loadAIsource(username, AIsourcename) {
	AIsources_set[username] ??= {}
	if (!AIsources_set[username][AIsourcename]) {
		const AIsources_dir = getUserDictionary(username) + '/AIsources/' + AIsourcename
		/** @type {import('../decl/AIsource.ts').AIsource_t} */
		const AIsource = (await import(AIsources_dir + '/main.mjs')).default
		const result = AIsource.Load()
		if (result.success) AIsources_set[username][AIsourcename] = AIsource
		else throw new Error(result.message)
	}
	return AIsources_set[username][AIsourcename]
}

export function unloadAIsource(username, AIsourcename) {
	if (AIsources_set[username]?.[AIsourcename]) {
		/** @type {import('../decl/AIsource.ts').AIsource_t} */
		const AIsource = AIsources_set[username][AIsourcename]
		AIsource.Unload()
		delete AIsources_set[username][AIsourcename]
	}
}

export async function initAIsource(username, AIsourcename) {
	let AIsources_dir = getUserDictionary(username) + '/AIsources/' + AIsourcename
	/** @type {import('../decl/AIsource.ts').AIsource_t} */
	const AIsource = (await import(AIsources_dir + '/main.mjs')).default
	const result = AIsource.Init()
	if (!result.success) {
		fs.rmSync(AIsources_dir, { recursive: true, force: true })
		throw new Error(result.message)
	}
}

export async function uninstallAIsource(username, AIsourcename) {
	/** @type {import('../decl/AIsource.ts').AIsource_t} */
	const AIsource = await loadAIsource(username, AIsourcename)
	AIsource.Uninstall()
	fs.rmSync(getUserDictionary(username) + '/AIsources/' + AIsourcename, { recursive: true, force: true })
}
