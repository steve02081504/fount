import fs from 'node:fs'
import url from 'node:url'

import { FullProxy } from 'npm:full-proxy'

import { run_git } from '../scripts/git.mjs'
import { console } from '../scripts/i18n.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'
import { getLocalizedInfo } from '../scripts/locale.mjs'
import { nicerWriteFileSync } from '../scripts/nicerWriteFile.mjs'
import { doProfile } from '../scripts/profiler.mjs'

import { getUserByUsername, getUserDictionary } from './auth.mjs'
import { __dirname } from './base.mjs'
import { loadPart } from './managers/index.mjs'
import { save_config, setDefaultStuff } from './server.mjs'
import { loadData, saveData } from './setting_loader.mjs'
import { getPartRouter, deletePartRouter } from './web_server/parts_router.mjs'

export function setDefaultPart(user, parttype, partname) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	if (partname == user.defaultParts?.[parttype]) return
	const defaultParts = user.defaultParts ??= {}
	if (!partname) delete defaultParts[parttype]
	else defaultParts[parttype] = partname
	save_config()
}
export function getDefaultParts(user) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	return user?.defaultParts || {}
}
/**
 * @typedef {Object} PartInfo
 * @property {Record<string, string>} [name] - Localized name of the part.
 * @property {Record<string, string>} [avatar] - Localized avatar URL of the part.
 * @property {Record<string, string>} [description] - Localized short description of the part.
 * @property {Record<string, string>} [description_markdown] - Localized markdown description of the part.
 * // ... other potential info properties
 */

/**
 * @typedef {Object} PartInterfaces
 * @property {Object} [config] - Configuration interface.
 * @property {Function} [config.SetData] - Function to set configuration data.
 * // ... other potential interfaces
 */

/**
 * @typedef {Object} Part
 * @property {PartInfo} [info] - Information about the part.
 * @property {PartInterfaces} [interfaces] - Interfaces provided by the part.
 * @property {function(Initargs_t): Promise<void>} [Init] - Initialization function.
 * @property {function(Loadargs_t): Promise<void>} [Load] - Load function.
 * @property {function(UnloadArgs_t): Promise<void>} [Unload] - Unload function.
 * @property {function(UninstallArgs_t): Promise<void>} [Uninstall] - Uninstall function.
 */

/**
 * @typedef {Object} PartDetails
 * @property {PartInfo} info - Localized information about the part.
 * @property {string[]} supportedInterfaces - List of supported interfaces.
 */

export const parts_set = {}

/**
 * Gets the path to a part based on username, part type, and part name.
 * It checks for user-specific parts first, then falls back to public parts.
 *
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part (e.g., 'shells', 'worlds').
 * @param {string} partname - The name of the part.
 * @returns {string} The path to the part's directory.
 */
export function GetPartPath(username, parttype, partname) {
	const userPath = getUserDictionary(username) + '/' + parttype + '/' + partname
	if (fs.existsSync(userPath + '/main.mjs'))
		return userPath
	return __dirname + '/src/public/' + parttype + '/' + partname
}

/**
 * Loads a part from a given path, handling git updates if the part is in a git repository.
 *
 * @async
 * @param {string} path - The path to the part's directory.
 * @returns {Promise<Part>} A promise that resolves to the loaded part object.
 */
export async function baseMjsPartLoader(path) {
	const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default
	return part
}

/**
 * Checks if a part is currently loaded in memory.
 *
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @returns {boolean} True if the part is loaded, false otherwise.
 */
export function isPartLoaded(username, parttype, partname) {
	return !!parts_set?.[username]?.[parttype]?.[partname]
}

/**
 * Base function to load a part, using provided or default path getter and loader.
 * If the part is already loaded, it returns the existing instance.
 *
 * @async
 * @template T
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {Object} [options] - Optional configuration for loading.
 * @param {() => string} [options.pathGetter=GetPartPath] - Function to get the part's path.
 * @param {(path: string) => Promise<T>} [options.Loader=baseMjsPartLoader] - Function to load the part from the path.
 * @returns {Promise<T>} A promise that resolves to the loaded part instance.
 */
export async function baseloadPart(username, parttype, partname, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = baseMjsPartLoader,
} = {}) {
	if (isPartLoaded(username, parttype, partname)) return parts_set[username][parttype][partname]
	const path = pathGetter()

	if (fs.existsSync(path + '/.git')) try {
		const git = run_git.withPath(path)
		await git('fetch origin')
		const currentBranch = await git('rev-parse --abbrev-ref HEAD')
		const remoteBranch = await git('rev-parse --abbrev-ref --symbolic-full-name "@{u}"')
		if (!remoteBranch)
			console.warnI18n('fountConsole.partManager.git.noUpstream', { currentBranch })
		else {
			const mergeBase = await git('merge-base ' + currentBranch + ' ' + remoteBranch)
			const localCommit = await git('rev-parse ' + currentBranch)
			const remoteCommit = await git('rev-parse ' + remoteBranch)
			const status = await git('status --porcelain')
			if (status)
				console.warnI18n('fountConsole.partManager.git.dirtyWorkingDirectory')

			if (localCommit !== remoteCommit)
				if (mergeBase === localCommit) {
					console.logI18n('fountConsole.partManager.git.updating')
					await git('fetch origin')
					await git('reset --hard ' + remoteBranch)
				}
				else if (mergeBase === remoteCommit)
					console.logI18n('fountConsole.partManager.git.localAhead')

				else {
					console.logI18n('fountConsole.partManager.git.diverged')
					await git('fetch origin')
					await git('reset --hard ' + remoteBranch)
				}
			else
				console.logI18n('fountConsole.partManager.git.upToDate')
		}
	} catch (e) {
		console.errorI18n('fountConsole.partManager.git.updateFailed', { error: e })
	}
	else if (fs.existsSync(path + '/.isdefault')) {
		// 默认组件更新：在载入前自 __dirname + '/default/templates/user/' + parttype + '/' + partname 同步文件
		const userPath = path
		const { type, dirname } = loadJsonFile(userPath + '/fount.json')
		const templatePath = __dirname + '/default/templates/user/' + type + '/' + dirname
		function mapper(fileOrDir) {
			if (fs.statSync(templatePath + '/' + fileOrDir).isDirectory()) {
				if (!fs.existsSync(userPath + '/' + fileOrDir))
					fs.mkdirSync(userPath + '/' + fileOrDir, { recursive: true })
				fs.readdirSync(fileOrDir).forEach(path => mapper(fileOrDir + '/' + path))
			}
			else
				nicerWriteFileSync(userPath + '/' + fileOrDir, fs.readFileSync(templatePath + '/' + fileOrDir))
		}
		fs.readdirSync(templatePath).forEach(mapper)
	}
	return await Promise.resolve(Loader(path)).catch(e => {
		const parts_details_cache = loadData(username, 'parts_details_cache')
		delete parts_details_cache[parttype]?.[partname]
		saveData(username, 'parts_details_cache')
		throw e
	})
}

export async function baseMjsPartUnloader(path) {
	if (!fs.existsSync(path)) return
	async function codeunloader(path) {
		/*
		todo: implement codeunloader after moveing fount from deno to bun/done
		deno ll never support this, see also:
		https://github.com/denoland/deno/issues/27820
		https://github.com/denoland/deno/issues/28126
		https://github.com/denoland/deno/issues/25780
		*/
	}
	// get all the js/ts/mjs/cjs/wasm files in the path and call codeunloader
	await Promise.all(
		fs.readdirSync(path, { withFileTypes: true, recursive: true })
			.filter(file => file.isFile() && /\.(js|ts|mjs|cjs|wasm)$/.test(file.name))
			.map(file => file.parentPath + '/' + file.name)
			.map(f => codeunloader(f).catch(console.error))
	)
}

/**
 * Base function to load and initialize a part. Handles initialization and loading lifecycle.
 * Uses template parameters for part type and initialization arguments for better type safety.
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {Initargs_t} Initargs - Initialization arguments to be passed to the part's Init function.
 * @param {Object} [functions] - Optional functions to customize the loading and initialization process.
 * @param {() => string} [functions.pathGetter=GetPartPath] - Function to get the part's path.
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Loader=defaultLoader] - Function to load the part from the path. Defaults to baseMjsPartLoader and calls part.Load.
 * @param {(part: T) => void} [functions.afterLoad=part => {}] - Function to be called after the part is loaded.
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Initer=defaultIniter] - Function to initialize the part from the path. Defaults to baseMjsPartLoader and calls part.Init.
 * @param {(part: T) => void} [functions.afterInit=part => {}] - Function to be called after the part is initialized.
 * @returns {Promise<FullProxy<T>>} A promise that resolves to a FullProxy of the loaded and initialized part instance.
 */
export async function loadPartBase(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = async (path, Initargs) => {
		try {
			const part = await baseMjsPartLoader(path)
			await part.Load?.(Initargs)
			return part
		}
		catch (e) {
			await baseMjsPartUnloader(path).catch(x => 0)
			throw e
		}
	},
	afterLoad = part => { },
	Initer = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Init?.(Initargs)
		return part
	},
	afterInit = part => { },
} = {}) {
	Initargs = {
		router: getPartRouter(username, parttype, partname),
		...Initargs
	}
	parts_set[username] ??= { // 指定卸载顺序 world > char > persona > shell > AIsource > AIsourceGenerator
		worlds: {},
		chars: {},
		personas: {},
		shells: {},
		AIsources: {},
		AIsourceGenerators: {},
	}
	parts_set[username][parttype] ??= {}
	const parts_init = loadData(username, 'parts_init')
	const parts_config = loadData(username, 'parts_config')
	try {
		if (!parts_init[parttype]?.[partname]) {
			const profile = await doProfile(async () => {
				parts_init[parttype] ??= {}
				parts_init[parttype][partname] = initPart(username, parttype, partname, Initargs, { pathGetter, Initer, afterInit })
				parts_init[parttype][partname] = await parts_init[parttype][partname]
			})
			console.logI18n('fountConsole.partManager.partInited', {
				parttype,
				partname
			})
			console.log(profile)
			parts_init[parttype][partname] = true
			saveData(username, 'parts_init')
		}
		if (parts_init[parttype][partname] instanceof Promise)
			parts_init[parttype][partname] = await parts_init[parttype][partname]
		if (!parts_set[username][parttype][partname]) {
			const profile = await doProfile(async () => {
				/** @type {T} */
				parts_set[username][parttype][partname] = baseloadPart(username, parttype, partname, { pathGetter, Loader: async path => await Loader(path, Initargs) })
				const part = parts_set[username][parttype][partname] = await parts_set[username][parttype][partname]
				try {
					await part.interfaces?.config?.SetData?.(parts_config[parttype]?.[partname] ?? {})
				}
				catch (error) {
					console.error(`Failed to set data for part ${partname}: ${error.message}\n${error.stack}`)
				}
				await afterLoad(part)
			})
			console.logI18n('fountConsole.partManager.partLoaded', {
				parttype,
				partname
			})
			console.log(profile)
		}
		if (parts_set[username][parttype][partname] instanceof Promise)
			parts_set[username][parttype][partname] = await parts_set[username][parttype][partname]
	}
	finally {
		setDefaultStuff()
	}
	return new FullProxy(() => parts_set[username][parttype][partname])
}

/**
 * Initializes a part. This function is separated from `loadPartBase` to allow for re-initialization without reloading.
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {Initargs_t} Initargs - Initialization arguments.
 * @param {Object} [options] - Optional functions to customize the initialization process.
 * @param {() => string} [options.pathGetter=GetPartPath] - Function to get the part's path.
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [options.Initer=defaultIniter] - Function to initialize the part from the path. Defaults to baseMjsPartLoader and calls part.Init.
 * @param {(part: T) => void} [options.afterInit=part => {}] - Function to be called after the part is initialized.
 */
export async function initPart(username, parttype, partname, Initargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Initer = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Init?.(Initargs)
		return part
	},
	afterInit = part => { },
} = {}) {
	const part = await Initer(pathGetter(), Initargs)
	await afterInit(part)
}

/**
 * Unloads a part from memory, calling its Unload function if it exists.
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {UnloadArgs_t} unLoadargs - Arguments to be passed to the part's Unload function.
 * @param {Object} [options] - Optional functions to customize the unLoading process.
 * @param {(part: T) => Promise<void>} [options.unLoader=part => part.Unload?.(unLoadargs)] - Function to unload the part. Defaults to calling part.Unload.
 * @returns {Promise<void>} A promise that resolves when the part is unloaded.
 */
export async function unloadPartBase(username, parttype, partname, unLoadargs, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	unLoader = part => part.Unload?.(unLoadargs),
	afterUnload = baseMjsPartUnloader,
} = {}) {
	/** @type {T} */
	const part = parts_set[username][parttype][partname]
	if (!part) return
	try {
		await unLoader(part)
		await deletePartRouter(username, parttype, partname)
	}
	catch (error) {
		console.error(error)
	}
	await afterUnload(pathGetter(), unLoadargs)
	delete parts_set[username][parttype][partname]
}

/**
 * Uninstalls a part, unloading it first, then calling its Uninstall function (if exists) and removing its directory.
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @template UninstallArgs_t
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {UnloadArgs_t} unLoadargs - Arguments to be passed to the part's Unload function.
 * @param {UninstallArgs_t} uninstallArgs - Arguments to be passed to the part's Uninstall function.
 * @param {Object} [options] - Optional functions to customize the uninstallation process.
 * @param {(path: string) => Promise<T>} [options.Loader=baseMjsPartLoader] - Function to load the part from the path (used if part is not already loaded for uninstall).
 * @param {(part: T) => Promise<void>} [options.unLoader=part => part.Unload?.(unLoadargs)] - Function to unload the part. Defaults to calling part.Unload.
 * @param {() => string} [options.pathGetter=GetPartPath] - Function to get the part's path.
 * @param {(part: T, path: string) => Promise<void>} [options.Uninstaller=defaultUninstaller] - Function to uninstall the part. Defaults to calling part.Uninstall and removing the directory.
 * @returns {Promise<void>} A promise that resolves when the part is uninstalled.
 */
export async function uninstallPartBase(username, parttype, partname, unLoadargs, uninstallArgs, {
	Loader = baseMjsPartLoader,
	unLoader = part => part.Unload?.(unLoadargs),
	pathGetter = () => GetPartPath(username, parttype, partname),
	Uninstaller = async (part, path) => {
		await part?.Uninstall?.(uninstallArgs)
		fs.rmSync(path, { recursive: true, force: true })
	}
} = {}) {
	/** @type {T | undefined} */
	let part = parts_set[username][parttype][partname]
	if (getDefaultParts(username)[parttype] == partname)
		setDefaultPart(username, parttype, null)
	try {
		await unloadPartBase(username, parttype, partname, unLoadargs, { unLoader })
	} catch (error) { console.error(error) }
	try {
		part ??= await baseloadPart(username, parttype, partname, { Loader, pathGetter })
	} catch (error) { console.error(error) }
	await Uninstaller(part, pathGetter())
	delete parts_set[username][parttype][partname]
	const parts_details_cache = loadData(username, 'parts_details_cache')
	parts_details_cache[parttype] ??= {}
	delete parts_details_cache[parttype][partname]
	saveData(username, 'parts_details_cache')
	const parts_config = loadData(username, 'parts_config')
	parts_config[parttype] ??= {}
	delete parts_config[parttype][partname]
	saveData(username, 'parts_config')
	const parts_init = loadData(username, 'parts_init')
	parts_init[parttype] ??= {}
	delete parts_init[parttype][partname]
	saveData(username, 'parts_init')
}

/**
 * Gets a list of available parts for a given user and part type.
 *
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {Object} [options] - Optional filters and mappers for the part list.
 * @param {(file: fs.Dirent) => boolean} [options.PathFilter=defaultPathFilter] - Function to filter directory entries. Defaults to checking for directories with 'main.mjs'.
 * @param {(file: fs.Dirent) => string} [options.ResultMapper=file => file.name] - Function to map directory entry to result. Defaults to returning file name.
 * @returns {string[]} An array of part names.
 */
export function getPartListBase(username, parttype, {
	PathFilter = file => fs.existsSync(file.parentPath + '/' + file.name + '/main.mjs'),
	ResultMapper = file => file.name
} = {}) {
	const part_dir = getUserDictionary(username) + '/' + parttype
	let partlist = fs.readdirSync(part_dir, { withFileTypes: true }).filter(PathFilter)
	try {
		const publiclist = fs.readdirSync(__dirname + '/src/public/' + parttype, { withFileTypes: true }).filter(PathFilter)
		partlist = [...new Set(partlist.concat(publiclist))]
	} catch (e) { }
	return partlist.map(ResultMapper)
}

async function nocacheGetPartBaseDetails(username, parttype, partname) {
	const parts_details_cache = loadData(username, 'parts_details_cache')
	try {
		const part = await baseloadPart(username, parttype, partname).catch(() => loadPart(username, parttype, partname))
		const info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
		parts_details_cache[parttype] ??= {}
		return parts_details_cache[parttype][partname] = {
			info: JSON.parse(JSON.stringify(info)),
			supportedInterfaces: Object.keys(part.interfaces || {}),
		}
	}
	catch (error) {
		return {
			info: {
				name: partname,
				avatar: 'https://api.iconify.design/line-md/emoji-frown-open.svg',
				description: 'error loading part',
				description_markdown: `# error loading part\n\n\`\`\`\`\n${error.message}\n${error.stack}\n\`\`\`\``,
			},
			supportedInterfaces: [],
		}
	}
}

function getSfwInfo(info) {
	if (!info) return info
	const sfwInfo = { ...info }
	for (const key in info)
		if (key.startsWith('sfw_')) {
			const originalKey = key.substring(4) // remove 'sfw_'
			sfwInfo[originalKey] = info[key]
		}
	return sfwInfo
}

/**
 * Retrieves detailed information about a part, either from cache or by loading the part.
 *
 * @async
 * @param {string} username - The username of the user.
 * @param {string} parttype - The type of the part.
 * @param {string} partname - The name of the part.
 * @param {boolean} [nocache=false] - If true, bypasses the cache and forces loading the part.
 * @returns {Promise<PartDetails>} A promise that resolves to the detailed part information.
 */
export async function getPartDetails(username, parttype, partname, nocache = false) {
	/** @type {PartDetails | undefined} */
	let details = nocache ? undefined : loadData(username, 'parts_details_cache')?.[parttype]?.[partname]
	const user = getUserByUsername(username)
	if (!details) details = await nocacheGetPartBaseDetails(username, parttype, partname)
	else if (isPartLoaded(username, parttype, partname)) await Promise.any([
		nocacheGetPartBaseDetails(username, parttype, partname).then(result => details = result),
		new Promise(resolve => setTimeout(resolve, 500)),
	])
	let info = getLocalizedInfo(details.info, user.locales)
	if (user.sfw) info = getSfwInfo(info)

	return { ...details, info }
}
