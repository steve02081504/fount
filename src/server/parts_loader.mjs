import { getUserDictionary } from './auth.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import fs from 'fs'
import url from 'url'
import { __dirname } from './server.mjs'

let parts_set = {}

function GetPartPath(username, parttype, partname) {
	let userPath = getUserDictionary(username) + '/' + parttype + '/' + partname
	if (fs.existsSync(userPath+'/main.mjs'))
		return userPath
	return __dirname + '/src/public/' + parttype + '/' + partname
}

export async function baseloadPart(username, parttype, partname, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = async (path) => {
		const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default
		return part
	},
}={}) {
	if (!parts_set?.[username]?.[parttype])
		return await Loader(pathGetter())
	return parts_set[username][parttype][partname]
}

export async function loadPart(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = async (path, Initargs) => {
		const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default
		const result = part.Load(Initargs)
		if (!result?.success) throw new Error(result?.message)
		return part
	},
}={}) {
	parts_set[username] ??= { // 指定卸载顺序 shell > world > char > persona > AIsource > AIsourceGenerator
		shells: {},
		worlds: {},
		chars: {},
		personas: {},
		AIsources: {},
		AIsourceGenerators: {},
	}
	parts_set[username][parttype] ??= {}
	if (!parts_set[username][parttype][partname])
		parts_set[username][parttype][partname] = await Loader(pathGetter(), Initargs)
	return parts_set[username][parttype][partname]
}

export function initPart(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = async (path, Initargs) => {
		const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default
		const result = part.Init(Initargs)
		if (!result?.success) {
			fs.rmSync(path, { recursive: true, force: true })
			throw new Error(result?.message)
		}
		return part
	}
}={}) {
	return Loader(pathGetter(), Initargs)
}

export function unloadPart(username, parttype, partname, unLoadargs, {
	unLoader = (part) => part.Unload(unLoadargs),
}={}) {
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
	unLoader = (part) => part.Unload(unLoadargs),
	pathGetter = () => GetPartPath(username, parttype, partname),
	Uninstaller = (part, path) => {
		part.Uninstall(uninstallArgs)
		fs.rmSync(path, { recursive: true, force: true })
	}
}={}) {
	const part = parts_set[username][parttype][partname]
	try {
		unloadPart(username, parttype, partname, unLoadargs, { unLoader })
	} catch (error) {
		console.error(error)
	}
	Uninstaller(part, pathGetter())
}
