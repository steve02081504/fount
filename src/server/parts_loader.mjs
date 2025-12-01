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
import { events } from './events.mjs'
import { getPartList, loadPart } from './managers/index.mjs'
import { save_config, setDefaultStuff, skip_report } from './server.mjs'
import { loadData, saveData } from './setting_loader.mjs'
import { sendEventToUser } from './web_server/event_dispatcher.mjs'
import { getPartRouter, deletePartRouter } from './web_server/parts_router.mjs'

/**
 * 为用户设置默认部件。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {void}
 */
export function setDefaultPart(user, parttype, partname) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	// TODO: remove this
	if (!(Object(user.defaultParts[parttype]) instanceof Array)) user.defaultParts[parttype] = []
	const defaultParts = (user.defaultParts ??= {})[parttype] ??= []
	if (defaultParts.includes(partname)) return
	defaultParts.push(partname)
	save_config()
	sendEventToUser(user.username, 'default-part-setted', { parttype, partname })
}

/**
 * 从用户的默认部件列表中移除一个部件。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 要移除的部件名称。
 * @returns {void}
 */
export function unsetDefaultPart(user, parttype, partname) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	// TODO: remove this
	if (!(Object(user.defaultParts[parttype]) instanceof Array)) user.defaultParts[parttype] = []
	const defaultParts = (user.defaultParts ?? {})[parttype] ?? []
	const index = defaultParts.indexOf(partname)
	if (index == -1) return
	defaultParts.splice(index, 1)
	if (!defaultParts.length) delete user.defaultParts?.[parttype]
	save_config()
	sendEventToUser(user.username, 'default-part-unsetted', { parttype, partname })
}
/**
 * 获取用户的默认部件。
 * @param {object | string} user - 用户对象或用户名。
 * @returns {Record<string, string[]>} 用户的默认部件。
 */
export function getDefaultParts(user) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	return user?.defaultParts || {}
}

/**
 * 获取用户指定类型的一个随机默认部件名称。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parttype - 部件类型。
 * @returns {string | undefined} 一个随机的部件名称，如果列表为空则为 undefined。
 */
export function getAnyDefaultPart(user, parttype) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultParts = user?.defaultParts?.[parttype] || []
	return defaultParts[Math.floor(Math.random() * defaultParts.length)]
}

/**
 * 获取用户指定类型的所有默认部件名称。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parttype - 部件类型。
 * @returns {string[]} 指定类型的所有默认部件名称。
 */
export function getAllDefaultParts(user, parttype) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	return user?.defaultParts?.[parttype] || []
}

/**
 * 获取用户指定类型的一个随机首选默认部件名称。
 * 如果默认列表为空，则从所有可用部件中随机选择一个。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parttype - 部件类型。
 * @returns {string | undefined} 一个随机的部件名称，如果没有任何可用部件则为 undefined。
 */
export function getAnyPreferredDefaultPart(user, parttype) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultPartNames = getAllDefaultParts(user, parttype)
	if (defaultPartNames.length)
		return defaultPartNames[Math.floor(Math.random() * defaultPartNames.length)]
	const allPartNames = getPartList(user.username, parttype)
	return allPartNames[Math.floor(Math.random() * allPartNames.length)]
}

/**
 * 通知客户端部件已安装。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {void}
 */
export function notifyPartInstall(username, parttype, partname) {
	events.emit('part-installed', { username, parttype, partname })
	sendEventToUser(username, 'part-installed', { parttype, partname })
}
/**
 * @typedef {Object} PartInfo
 * @property {Record<string, string>} [name] - 部件的本地化名称。
 * @property {Record<string, string>} [avatar] - 部件的本地化头像URL。
 * @property {Record<string, string>} [description] - 部件的本地化简短描述。
 * @property {Record<string, string>} [description_markdown] - 部件的本地化 markdown 描述。
 * // ... 其他潜在的信息属性
 */

/**
 * @typedef {Object} PartInterfaces
 * @property {Object} [config] - 配置界面。
 * @property {Function} [config.SetData] - 设置配置数据的函数。
 * // ... 其他潜在的界面
 */

/**
 * @typedef {Object} Part
 * @property {PartInfo} [info] - 关于部件的信息。
 * @property {PartInterfaces} [interfaces] - 部件提供的界面。
 * @property {function(Initargs_t): Promise<void>} [Init] - 初始化函数。
 * @property {function(Loadargs_t): Promise<void>} [Load] - 加载函数。
 * @property {function(UnloadArgs_t): Promise<void>} [Unload] - 卸载函数。
 * @property {function(UninstallArgs_t): Promise<void>} [Uninstall] - 卸载函数。
 */

/**
 * @typedef {Object} PartDetails
 * @property {PartInfo} info - 关于部件的本地化信息。
 * @property {string[]} supportedInterfaces - 支持的界面列表。
 */

/**
 * 一个存储已加载部件实例的对象。
 * @type {object}
 */
export const parts_set = {}

/**
 * 根据用户名、部件类型和部件名称获取部件的路径。
 * 它首先检查用户特定的部件，然后回退到公共部件。
 *
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型（例如，'shells'，'worlds'）。
 * @param {string} partname - 部件的名称。
 * @returns {string} 部件目录的路径。
 */
export function GetPartPath(username, parttype, partname) {
	const userPath = getUserDictionary(username) + '/' + parttype + '/' + partname
	if (fs.existsSync(userPath + '/main.mjs'))
		return userPath
	return __dirname + '/src/public/' + parttype + '/' + partname
}

/**
 * 从给定路径加载部件，如果部件位于git存储库中，则处理git更新。
 *
 * @async
 * @param {string} path - 部件目录的路径。
 * @returns {Promise<Part>} 一个解析为加载的部件对象的承诺。
 */
export async function baseMjsPartLoader(path) {
	try {
		return (await import(url.pathToFileURL(path + '/main.mjs'))).default
	} catch (e) { throw skip_report(e) }
}

/**
 * 检查部件当前是否已加载到内存中。
 *
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {boolean} 如果部件已加载则为 true，否则为 false。
 */
export function isPartLoaded(username, parttype, partname) {
	return !!parts_set?.[username]?.[parttype]?.[partname]
}

/**
 * 加载部件的基本函数，使用提供的或默认的路径获取器和加载器。
 * 如果部件已加载，则返回现有实例。
 *
 * @async
 * @template T
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {Object} [options] - 加载的可选配置。
 * @param {() => string} [options.pathGetter=GetPartPath] - 获取部件路径的函数。
 * @param {(path: string) => Promise<T>} [options.Loader=baseMjsPartLoader] - 从路径加载部件的函数。
 * @returns {Promise<T>} 一个解析为加载的部件实例的承诺。
 */
export async function baseloadPart(username, parttype, partname, {
	pathGetter = () => GetPartPath(username, parttype, partname),
	Loader = baseMjsPartLoader,
} = {}) {
	if (isPartLoaded(username, parttype, partname)) return parts_set[username][parttype][partname]
	const path = pathGetter()

	if (fs.existsSync(path + '/.git')) try {
		const git = run_git.withPath(path)
		await git('config core.autocrlf false')
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
		/**
		 * 递归地将文件从模板目录映射到用户目录。
		 * @param {string} fileOrDir - 要映射的文件或目录。
		 */
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

/**
 * 卸载一个基础的 mjs 部件。
 * @param {string} path - 部件的路径。
 */
export async function baseMjsPartUnloader(path) {
	if (!fs.existsSync(path)) return
	/**
	 * 卸载代码。
	 * @param {string} path - 要卸载的代码的路径。
	 */
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

const parts_load_results = {}
/**
 * 加载和初始化部件的基础函数。处理初始化和加载生命周期。
 * 使用模板参数来指定部件类型和初始化参数，以获得更好的类型安全。
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {Initargs_t} Initargs - 传递给部件 Init 函数的初始化参数。
 * @param {Object} [functions] - 用于自定义加载和初始化过程的可选函数。
 * @param {() => string} [functions.pathGetter=GetPartPath] - 获取部件路径的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Loader=defaultLoader] - 从路径加载部件的函数。默认为 baseMjsPartLoader 并调用 part.Load。
 * @param {(part: T) => void} [functions.afterLoad=part => {}] - 部件加载后调用的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Initer=defaultIniter] - 从路径初始化部件的函数。默认为 baseMjsPartLoader 并调用 part.Init。
 * @param {(part: T) => void} [functions.afterInit=part => {}] - 部件初始化后调用的函数。
 * @returns {Promise<FullProxy<T>>} 一个解析为加载和初始化的部件实例的 FullProxy 的承诺。
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
		notifyPartInstall(username, parttype, partname)
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
				parts_set[username][parttype][partname] = (async () => {
					/** @type {T} */
					const part = await baseloadPart(username, parttype, partname, {
						pathGetter,
						/**
						 * 异步加载器函数。
						 * @param {string} path - 部件的路径。
						 * @returns {Promise<T>} 解析为加载的部件的承诺。
						 */
						Loader: async path => await Loader(path, Initargs)
					})
					try {
						await part.interfaces?.config?.SetData?.(parts_config[parttype]?.[partname] ?? {})
					}
					catch (error) {
						console.error(`Failed to set data for part ${partname}: ${error.message}\n${error.stack}`)
					}
					await afterLoad(part)
					return part
				})()
				parts_set[username][parttype][partname] = await parts_set[username][parttype][partname]
			})
			console.logI18n('fountConsole.partManager.partLoaded', {
				parttype,
				partname
			})
			console.log(profile)
			events.emit('part-loaded', { username, parttype, partname })
		}
		if (parts_set[username][parttype][partname] instanceof Promise)
			parts_set[username][parttype][partname] = await parts_set[username][parttype][partname]
	}
	finally {
		setDefaultStuff()
	}
	parts_load_results[username] ??= {}
	parts_load_results[username][parttype] ??= {}
	return parts_load_results[username][parttype][partname] ??= new FullProxy(() => parts_set[username][parttype][partname])
}

/**
 * 初始化一个部件。此函数与 `loadPartBase` 分离，以便在不重新加载的情况下重新初始化。
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {Initargs_t} Initargs - 初始化参数。
 * @param {Object} [options] - 用于自定义初始化过程的可选函数。
 * @param {() => string} [options.pathGetter=GetPartPath] - 获取部件路径的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [options.Initer=defaultIniter] - 从路径初始化部件的函数。默认为 baseMjsPartLoader 并调用 part.Init。
 * @param {(part: T) => void} [options.afterInit=part => {}] - 部件初始化后调用的函数。
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
 * 从内存中卸载一个部件，如果存在，则调用其 Unload 函数。
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {UnloadArgs_t} unLoadargs - 传递给部件 Unload 函数的参数。
 * @param {Object} [options] - 用于自定义卸载过程的可选函数。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(part: T) => Promise<void>} [options.unLoader=part => part.Unload?.(unLoadargs)] - 卸载部件的函数。默认为调用 part.Unload。
 * @param {(path: string, unLoadargs: UnloadArgs_t) => Promise<void>} [options.afterUnload] - 卸载后调用的函数。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
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
	if (!Object.keys(parts_set[username][parttype]).length) delete parts_set[username][parttype]
	if (!Object.keys(parts_set[username]).length) delete parts_set[username]
	delete parts_load_results[username][parttype][partname]
	if (!Object.keys(parts_load_results[username][parttype]).length) delete parts_load_results[username][parttype]
	if (!Object.keys(parts_load_results[username]).length) delete parts_load_results[username]
}

/**
 * 卸载一个部件，首先卸载它，然后调用其 Uninstall 函数（如果存在）并删除其目录。
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @template UninstallArgs_t
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {UnloadArgs_t} unLoadargs - 传递给部件 Unload 函数的参数。
 * @param {UninstallArgs_t} uninstallArgs - 传递给部件 Uninstall 函数的参数。
 * @param {Object} [options] - 用于自定义卸载过程的可选函数。
 * @param {(path: string) => Promise<T>} [options.Loader=baseMjsPartLoader] - 从路径加载部件的函数（如果在卸载时部件尚未加载，则使用）。
 * @param {(part: T) => Promise<void>} [options.unLoader=part => part.Unload?.(unLoadargs)] - 卸载部件的函数。默认为调用 part.Unload。
 * @param {() => string} [options.pathGetter=GetPartPath] - 获取部件路径的函数。
 * @param {(part: T, path: string) => Promise<void>} [options.Uninstaller=defaultUninstaller] - 卸载部件的函数。默认为调用 part.Uninstall 并删除目录。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
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
	parts_set[username][parttype] ??= {}
	/** @type {T | undefined} */
	let part = parts_set[username][parttype][partname]
	if (getAllDefaultParts(username, parttype).includes(partname))
		unsetDefaultPart(username, parttype, partname)
	try {
		await unloadPartBase(username, parttype, partname, unLoadargs, { unLoader })
	} catch (error) { console.error(error) }
	try {
		part ??= await baseloadPart(username, parttype, partname, { Loader, pathGetter })
	} catch (error) { console.error(error) }
	await Uninstaller(part, pathGetter())
	events.emit('part-uninstalled', { username, parttype, partname })
	sendEventToUser(username, 'part-uninstalled', { parttype, partname })
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
 * 获取给定用户和部件类型的可用部件列表。
 *
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {Object} [options] - 部件列表的可选过滤器和映射器。
 * @param {(file: fs.Dirent) => boolean} [options.PathFilter=defaultPathFilter] - 过滤目录条目的函数。默认为检查具有“main.mjs”的目录。
 * @param {(file: fs.Dirent) => string} [options.ResultMapper=file => file.name] - 将目录条目映射到结果的函数。默认为返回文件名。
 * @returns {string[]} 部件名称数组。
 */
export function getPartListBase(username, parttype, {
	PathFilter = file => fs.existsSync(file.parentPath + '/' + file.name + '/main.mjs'),
	ResultMapper = file => file.name
} = {}) {
	const part_dir = getUserDictionary(username) + '/' + parttype
	if (!fs.existsSync(part_dir) || !fs.statSync(part_dir).isDirectory()) return []
	let partlist = fs.readdirSync(part_dir, { withFileTypes: true }).filter(PathFilter)
	try {
		const publiclist = fs.readdirSync(__dirname + '/src/public/' + parttype, { withFileTypes: true }).filter(PathFilter)
		partlist = [...new Set(partlist.concat(publiclist))]
	} catch (e) { }
	return partlist.map(ResultMapper)
}

/**
 * 获取部件的基本详细信息，而不使用缓存。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {Promise<object>} 一个解析为部件详细信息的承诺。
 */
async function nocacheGetPartBaseDetails(username, parttype, partname) {
	const parts_details_cache = loadData(username, 'parts_details_cache')
	try {
		const part = await baseloadPart(username, parttype, partname).catch(() => loadPart(username, parttype, partname))
		const info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
		parts_details_cache[parttype] ??= {}
		try {
			return parts_details_cache[parttype][partname] = {
				info: JSON.parse(JSON.stringify(info)),
				supportedInterfaces: Object.keys(part.interfaces || {}),
			}
		}
		finally {
			saveData(username, 'parts_details_cache')
		}
	}
	catch (error) {
		return {
			info: {
				'': {
					name: partname,
					avatar: 'https://api.iconify.design/line-md/emoji-frown-open.svg',
					description: 'error loading part',
					description_markdown: `# error loading part\n\n\`\`\`\`\n${error.message}\n${error.stack}\n\`\`\`\``,
				}
			},
			supportedInterfaces: [],
		}
	}
}

/**
 * 获取“对工作安全”的信息。
 * @param {object} info - 要处理的信息对象。
 * @returns {object} 处理后的信息对象。
 */
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
 * 检索关于部件的详细信息，可以从缓存中或通过加载部件来获取。
 *
 * @async
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {boolean} [nocache=false] - 如果为 true，则绕过缓存并强制加载部件。
 * @returns {Promise<PartDetails>} 一个解析为详细部件信息的承诺。
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

/**
 * 获取给定用户和部件类型的所有缓存部件详细信息。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @returns {Promise<{cachedDetails: object, uncachedNames: string[]}>} 一个解析为包含缓存的详细信息和未缓存的名称的对象的承诺。
 */
export async function getAllCachedPartDetails(username, parttype) {
	// 1. Get the full list of part names
	const allPartNames = getPartList(username, parttype)
	const allPartNamesSet = new Set(allPartNames)

	// 2. Get cached details
	const detailsCache = loadData(username, 'parts_details_cache')?.[parttype] || {}
	const user = getUserByUsername(username)
	const cachedDetails = {}

	// 3. Process cached parts (same logic as before)
	const promises = Object.keys(detailsCache).map(async (partname) => {
		// If a cached part is no longer in the file system, skip it
		if (!allPartNamesSet.has(partname)) return

		let details = detailsCache[partname]
		if (isPartLoaded(username, parttype, partname))
			await Promise.any([
				nocacheGetPartBaseDetails(username, parttype, partname).then(result => details = result),
				new Promise(resolve => setTimeout(resolve, 500)),
			])

		let info = getLocalizedInfo(details.info, user.locales)
		if (user.sfw) info = getSfwInfo(info)

		cachedDetails[partname] = { ...details, info }
	})

	await Promise.all(promises)

	// 4. Determine uncached names
	const uncachedNames = allPartNames.filter(name => !cachedDetails[name])

	// 5. Return the new structure
	return { cachedDetails, uncachedNames }
}
