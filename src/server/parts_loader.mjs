import { getUserDictionary } from './auth.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import fs from 'node:fs'
import url from 'node:url'
import { __dirname, setDefaultWindowTitle } from './server.mjs'
import { loadData, saveData } from './setting_loader.mjs'
import { exec } from './exec.mjs'

let parts_set = {}

function GetPartPath(username, parttype, partname) {
	let userPath = getUserDictionary(username) + '/' + parttype + '/' + partname
	if (fs.existsSync(userPath + '/main.mjs'))
		return userPath
	return __dirname + '/src/public/' + parttype + '/' + partname
}

export async function baseMjsPartLoader(path) {
	const part = (await import(url.pathToFileURL(path + `/main.mjs`))).default
	return part
}

export async function baseloadPart(username, parttype, partname, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = baseMjsPartLoader,
} = {}) {
	if (!parts_set?.[username]?.[parttype])
		return await Loader(pathGetter())
	return parts_set[username][parttype][partname]
}

export async function loadPart(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Load?.(Initargs)
		return part
	},
	afterLoad = (part) => { },
	Initer = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Init?.(Initargs)
		return part
	},
	afterInit = (part) => { },
} = {}) {
	parts_set[username] ??= { // 指定卸载顺序 shell > world > char > persona > AIsource > AIsourceGenerator
		shells: {},
		worlds: {},
		chars: {},
		personas: {},
		AIsources: {},
		AIsourceGenerators: {},
	}
	parts_set[username][parttype] ??= {}
	let parts_init = loadData(username, 'parts_init')
	try {
		if (!parts_init[parttype]?.[partname]) {
			await initPart(username, parttype, partname, Initargs, { pathGetter, Initer, afterInit })
			parts_init[parttype] ??= {}
			parts_init[parttype][partname] = true
			saveData(username, 'parts_init')
		}
		if (!parts_set[username][parttype][partname]) {
			parts_set[username][parttype][partname] = await Loader(pathGetter(), Initargs)
			await afterLoad(parts_set[username][parttype][partname])
		}
	}
	catch (error) {
		console.log(username, parttype, partname)
		console.trace()
		throw error
	}
	setDefaultWindowTitle()
	return parts_set[username][parttype][partname]
}

export async function initPart(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Initer = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Init?.(Initargs)
		return part
	},
	afterInit = (part) => { },
} = {}) {
	let part = await Initer(pathGetter(), Initargs)
	await afterInit(part)
}

export function unloadPart(username, parttype, partname, unLoadargs, {
	unLoader = (part) => part.Unload?.(unLoadargs),
} = {}) {
	const part = parts_set[username][parttype][partname]
	try {
		unLoader(part)
	}
	catch (error) {
		console.error(error)
	}
	delete parts_set[username][parttype][partname]
}
on_shutdown(() => {
	for (let username in parts_set)
		for (let parttype in parts_set[username])
			for (let partname in parts_set[username][parttype])
				unloadPart(username, parttype, partname)
})

export function uninstallPart(username, parttype, partname, unLoadargs, uninstallArgs, {
	unLoader = (part) => part.Unload?.(unLoadargs),
	pathGetter = () => GetPartPath(username, parttype, partname),
	Uninstaller = (part, path) => {
		part.Uninstall?.(uninstallArgs)
		fs.rmSync(path, { recursive: true, force: true })
	}
} = {}) {
	const part = parts_set[username][parttype][partname]
	try {
		unloadPart(username, parttype, partname, unLoadargs, { unLoader })
	} catch (error) {
		console.error(error)
	}
	Uninstaller(part, pathGetter())
}

export function getPartInfo(part, locale) {
	if (!part?.info) return
	return part.info[locale] || part.info[Object.keys(part.info)[0]]
}
