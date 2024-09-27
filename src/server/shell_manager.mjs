import fs from 'fs'
import { app } from './server.mjs'
import { on_shutdown } from './on_shutdown.mjs'

/** @type {Record<string, Record<string, import('../decl/shellAPI.ts').Shell_t>>} */
let shells_set = {}

export async function loadShell(username, shellname) {
	shells_set[username] ??= {}
	if (!shells_set[username][shellname]) {
		const shells_dir = getUserDictionary(username) + '/shells/' + shellname
		/** @type {import('../decl/shellAPI.ts').Shell_t} */
		const shell = (await import(shells_dir + '/main.mjs')).default
		const result = shell.Load(app)
		if (result.success) shells_set[username][shellname] = shell
		else throw new Error(result.message)
	}
	return shells_set[username][shellname]
}

export async function unloadShell(username, shellname) {
	/** @type {import('../decl/shellAPI.ts').Shell_t} */
	const shell = await loadShell(username, shellname)
	shell.Unload(app)
	delete shells_set[username][shellname]
}
on_shutdown(() => {
	for (let username in shells_set)
		for (let shellname in shells_set[username])
			unloadShell(username, shellname)
})

export async function initShell(username, shellname) {
	let shells_dir = getUserDictionary(username) + '/shells/' + shellname
	/** @type {import('../decl/shellAPI.ts').Shell_t} */
	const shell = (await import(shells_dir + '/main.mjs')).default
	const result = shell.Init()
	if (!result.success) {
		fs.rmSync(shells_dir, { recursive: true, force: true })
		throw new Error(result.message)
	}
}

export function uninstallShell(username, shellname) {
	/** @type {import('../decl/shellAPI.ts').Shell_t} */
	const shell = shells_set[username][shellname]
	shell.Uninstall()
	fs.rmSync(getUserDictionary(username) + '/shells/' + shellname, { recursive: true, force: true })
	delete shells_set[username][shellname]
}
