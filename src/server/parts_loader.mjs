import { getUserByUsername, getUserDictionary } from './auth.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import fs from 'node:fs'
import url from 'node:url'
import { __dirname, setDefaultStuff } from './server.mjs'
import { loadData, saveData } from './setting_loader.mjs'
import { loadPart } from './managers/index.mjs'
import { FullProxy } from '../scripts/proxy.mjs'

const parts_set = {}

export function GetPartPath(username, parttype, partname) {
	const userPath = getUserDictionary(username) + '/' + parttype + '/' + partname
	if (fs.existsSync(userPath + '/main.mjs'))
		return userPath
	return __dirname + '/src/public/' + parttype + '/' + partname
}

export async function baseMjsPartLoader(path) {
	const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default
	return part
}

export function isPartLoaded(username, parttype, partname) {
	return !!parts_set?.[username]?.[parttype]?.[partname]
}

export async function baseloadPart(username, parttype, partname, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = baseMjsPartLoader,
} = {}) {
	if (!parts_set?.[username]?.[parttype]?.[partname])
		return await Loader(pathGetter())
	return parts_set[username][parttype][partname]
}

export async function loadPartBase(username, parttype, partname, Initargs, {
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
	const parts_init = loadData(username, 'parts_init')
	const parts_config = loadData(username, 'parts_config')
	try {
		if (!parts_init[parttype]?.[partname]) {
			await initPart(username, parttype, partname, Initargs, { pathGetter, Initer, afterInit })
			parts_init[parttype] ??= {}
			parts_init[parttype][partname] = true
			saveData(username, 'parts_init')
		}
		if (!parts_set[username][parttype][partname]) {
			const part = parts_set[username][parttype][partname] = await Loader(pathGetter(), Initargs)
			parts_config[parttype] ??= {}
			await part.interfaces?.config?.SetData?.(parts_config[parttype][partname] ?? {})
			await afterLoad(part)
		}
	}
	catch (error) {
		console.log(username, parttype, partname)
		console.trace()
		throw error
	}
	setDefaultStuff()
	return new FullProxy(() => parts_set[username][parttype][partname])
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
	const part = await Initer(pathGetter(), Initargs)
	await afterInit(part)
}

export async function unloadPart(username, parttype, partname, unLoadargs, {
	unLoader = (part) => part.Unload?.(unLoadargs),
} = {}) {
	const part = parts_set[username][parttype][partname]
	try {
		await unLoader(part)
	}
	catch (error) {
		console.error(error)
	}
	delete parts_set[username][parttype][partname]
}
on_shutdown(async () => {
	for (const username in parts_set)
		for (const parttype in parts_set[username])
			for (const partname in parts_set[username][parttype])
				await unloadPart(username, parttype, partname)
})

export async function uninstallPartBase(username, parttype, partname, unLoadargs, uninstallArgs, {
	Loader = baseMjsPartLoader,
	unLoader = (part) => part.Unload?.(unLoadargs),
	pathGetter = () => GetPartPath(username, parttype, partname),
	Uninstaller = async (part, path) => {
		await part?.Uninstall?.(uninstallArgs)
		fs.rmSync(path, { recursive: true, force: true })
	}
} = {}) {
	let part = parts_set[username][parttype][partname]
	try {
		await unloadPart(username, parttype, partname, unLoadargs, { unLoader })
	} catch (error) {
		console.error(error)
	}
	try {
		part ??= await baseloadPart(username, parttype, partname, { Loader, pathGetter })
	} catch (error) {
		console.error(error)
	}
	await Uninstaller(part, pathGetter())
	delete parts_set[username][parttype][partname]
	const parts_details_cache = loadData(username, 'parts_details_cache')
	delete parts_details_cache[parttype][partname]
	const parts_init = loadData(username, 'parts_init')
	delete parts_init[parttype][partname]
}

export function getPartListBase(username, parttype, {
	PathFilter = (file) => file.isDirectory() && fs.existsSync(file.parentPath + '/' + file.name + '/main.mjs'),
	ResultMapper = (file) => file.name
} = {}) {
	const part_dir = getUserDictionary(username) + '/' + parttype
	let partlist = fs.readdirSync(part_dir, { withFileTypes: true }).filter(PathFilter)
	try {
		const publiclist = fs.readdirSync(__dirname + '/src/public/' + parttype, { withFileTypes: true }).filter(PathFilter)
		partlist = [...new Set(partlist.concat(publiclist))]
	} catch (e) { }
	return partlist.map(ResultMapper)
}

function getLocalizedInfo(info, locale) {
	if (!info) return
	return info[locale] ||
		info[locale?.split('-')?.[0]] ||
		info[Object.keys(info).find(key => key.startsWith(locale?.split('-')?.[0] + '-'))] ||
		info[Object.keys(info)[0]]
}

export function getPartInfo(part, locale) {
	return getLocalizedInfo(part?.info, locale)
}

export async function getPartDetails(username, parttype, partname, nocache = false) {
	const parts_details_cache = loadData(username, 'parts_details_cache')
	let details = parts_details_cache?.[parttype]?.[partname]
	if (nocache || parts_set?.[username]?.[parttype]?.[partname]) details = undefined
	if (!details) try {
		const part = await baseloadPart(username, parttype, partname).catch(() => loadPart(username, parttype, partname))
		parts_details_cache[parttype] ??= {}
		details = parts_details_cache[parttype][partname] = {
			info: JSON.parse(JSON.stringify(part.info)),
			supportedInterfaces: Object.keys(part.interfaces || {}),
		}
	}
	catch (error) {
		return {
			info: {
				name: partname,
				avatar: 'https://api.iconify.design/line-md/emoji-frown-open.svg',
				description: 'error loading part',
				description_markdown: `# error loading part\n\n\`\`\`\`\n${error.message}\n${error.stack}\`\`\`\``,
			},
			supportedInterfaces: [],
		}
	}
	const { locale } = getUserByUsername(username)
	return {
		...details,
		info: getLocalizedInfo(details.info, locale)
	}
}
