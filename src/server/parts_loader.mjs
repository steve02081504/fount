import fs from 'node:fs'
import path_module from 'node:path'
import { setTimeout } from 'node:timers'
import url from 'node:url'

import { FullProxy } from 'npm:full-proxy'
import trash from 'npm:trash'

import { run_git } from '../scripts/git.mjs'
import { console } from '../scripts/i18n.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'
import { getLocalizedInfo } from '../scripts/locale.mjs'
import { nicerWriteFileSync } from '../scripts/nicerWriteFile.mjs'
import { doProfile } from '../scripts/profiler.mjs'

import { getAllUsers, getUserByUsername, getUserDictionary } from './auth.mjs'
import { __dirname } from './base.mjs'
import { events } from './events.mjs'
import { restartor, save_config, setDefaultStuff, skip_report } from './server.mjs'
import { loadData, saveData } from './setting_loader.mjs'
import { sendEventToUser } from './web_server/event_dispatcher.mjs'
import { getPartRouter, deletePartRouter } from './web_server/parts_router.mjs'

/**
 * 为用户设置默认部件。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @param {string} child - 子部件名称。
 * @returns {void}
 */
export function setDefaultPart(user, parent, child) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultParts = (user.defaultParts ??= {})[parent] ??= []
	if (defaultParts.includes(child)) return
	defaultParts.push(child)
	save_config()
	sendEventToUser(user.username, 'default-part-setted', { parent, child })
}

/**
 * 从用户的默认部件列表中移除一个部件。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @param {string} child - 要移除的子部件名称。
 * @returns {void}
 */
export function unsetDefaultPart(user, parent, child) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultParts = (user.defaultParts ?? {})[parent] ?? []
	const index = defaultParts.indexOf(child)
	if (index == -1) return
	defaultParts.splice(index, 1)
	if (!defaultParts.length) delete user.defaultParts?.[parent]
	save_config()
	sendEventToUser(user.username, 'default-part-unsetted', { parent, child })
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
 * 获取用户指定父部件的一个随机默认子部件名称。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @returns {string | undefined} 一个随机的子部件名称，如果列表为空则为 undefined。
 */
export function getAnyDefaultPart(user, parent) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultParts = user?.defaultParts?.[parent] || []
	return defaultParts[Math.floor(Math.random() * defaultParts.length)]
}

/**
 * 获取用户指定父部件的所有默认子部件名称。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @returns {string[]} 指定父部件的所有默认子部件名称。
 */
export function getAllDefaultParts(user, parent) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	return user?.defaultParts?.[parent] || []
}

/**
 * 获取用户指定父部件的一个随机首选默认子部件名称。
 * 如果默认列表为空，则从所有可用部件中随机选择一个。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @returns {string | undefined} 一个随机的子部件名称，如果没有任何可用部件则为 undefined。
 */
export function getAnyPreferredDefaultPart(user, parent) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultPartNames = getAllDefaultParts(user, parent)
	if (defaultPartNames.length)
		return defaultPartNames[Math.floor(Math.random() * defaultPartNames.length)]
	const allPartNames = getPartList(user.username, parent)
	return allPartNames[Math.floor(Math.random() * allPartNames.length)]
}

/**
 * 加载用户指定父部件的一个随机首选默认子部件。
 * @param {object | string} user - 用户对象或用户名。
 * @param {string} parent - 父部件路径。
 * @returns {Promise<any | undefined>} 一个解析为已加载部件的承诺，如果没有任何可用部件则为 undefined。
 */
export async function loadAnyPreferredDefaultPart(user, parent) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const partname = getAnyPreferredDefaultPart(user, parent)
	if (!partname) return
	return loadPart(user.username, parent + '/' + partname, { username: user.username })
}

/**
 * 通知客户端部件已安装。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @returns {void}
 */
export function notifyPartInstall(username, partpath) {
	events.emit('part-installed', { username, partpath })
	sendEventToUser(username, 'part-installed', { partpath })
	invalidatePartBranchesCache(username)
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
 * @property {Object} [parts] - 子部件管理界面。
 * @property {function(string[]): string[]} [parts.getSubPartsList] - 获取子部件列表。
 * @property {function(string[], string, string): Promise<any>} [parts.loadSubPart] - 加载子部件。
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

const PARTS_BRANCH_CACHE_NAME = 'parts_branch_cache'

/**
 * 遍历指定目录下的所有 fount.json。
 * @param {string} rootPath - 要扫描的根目录。
 * @returns {string[]} - fount.json 的完整路径列表。
 */
function walkFountJsonFiles(rootPath) {
	const files = []
	if (!fs.existsSync(rootPath)) return files

	const stack = [rootPath]
	while (stack.length) {
		const current = stack.pop()
		let dirents = []
		try {
			dirents = fs.readdirSync(current, { withFileTypes: true })
		} catch { continue }

		for (const dirent of dirents) {
			const fullPath = path_module.join(current, dirent.name)
			if (dirent.isDirectory())
				stack.push(fullPath)

			else if (dirent.isFile() && dirent.name === 'fount.json')
				files.push(fullPath)

		}
	}

	return files
}

/**
 * 将路径片段合并到部件分支对象中。
 * @param {object} branches - 当前的分支对象。
 * @param {string[]} segments - 路径片段。
 */
function applyBranchSegments(branches, segments) {
	let cursor = branches
	for (const segment of segments) {
		if (!segment) continue
		cursor = cursor[segment] ??= {}
	}
}

/**
 * 将 fount.json 的内容合并到部件分支对象中。
 * @param {object} branches - 当前的分支对象。
 * @param {string} filePath - fount.json 路径。
 */
function mergeFountJsonIntoBranches(branches, filePath) {
	try {
		const info = loadJsonFile(filePath)
		const type = info.type?.trim?.() || ''
		const dirname = info.dirname?.trim?.() || ''
		if (!dirname) return
		const segments = [...type.split('/').filter(Boolean), dirname]
		applyBranchSegments(branches, segments)
	}
	catch (error) {
		console.warn(`Failed to parse fount.json at ${filePath}: ${error.message}`)
	}
}

/**
 * 扫描公共与用户目录，构建部件分支对象。
 * @param {string} username - 用户名。
 * @returns {object} - 部件分支对象。
 */
function buildPartBranches(username) {
	const branches = {}
	const roots = [
		path_module.join(__dirname, 'src/public/parts'),
		getUserDictionary(username),
	]

	for (const root of roots)
		for (const filePath of walkFountJsonFiles(root))
			mergeFountJsonIntoBranches(branches, filePath)

	return branches
}

/**
 * 使部件分支缓存失效。
 * @param {string} username - 用户名。
 */
function invalidatePartBranchesCache(username) {
	const cache = loadData(username, PARTS_BRANCH_CACHE_NAME)
	delete cache.branches
	delete cache.updatedAt
	saveData(username, PARTS_BRANCH_CACHE_NAME)
}

/**
 * 获取（并在需要时刷新）用户的部件分支结构。
 * @param {string} username - 用户名。
 * @param {{ nocache?: boolean }} [options] - 可选项。
 * @returns {object} - 部件分支对象。
 */
export function getPartBranches(username, { nocache = false } = {}) {
	const cache = loadData(username, PARTS_BRANCH_CACHE_NAME)
	if (!nocache && cache.branches) return cache.branches

	const branches = buildPartBranches(username)
	cache.branches = branches
	cache.updatedAt = Date.now()
	saveData(username, PARTS_BRANCH_CACHE_NAME)
	return branches
}

/**
 * 根据用户名和部件路径获取部件的路径。
 * 它首先检查用户特定的部件，然后回退到公共部件。
 *
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径（例如，'shells:chat'）。
 * @returns {string} 部件目录的路径。
 */
export function GetPartPath(username, partpath) {
	const userPath = getUserDictionary(username) + '/' + partpath
	if (fs.existsSync(userPath + '/main.mjs'))
		return userPath
	return __dirname + '/src/public/parts/' + partpath
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
 * @param {string} partpath - 部件的路径。
 * @returns {boolean} 如果部件已加载则为 true，否则为 false。
 */
export function isPartLoaded(username, partpath) {
	return !!parts_set?.[username]?.[partpath]
}

/**
 * 加载部件的包装函数。处理记录调用和父部件加载等细节，然后调用 loadPartBase。
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {Initargs_t} Initargs - 传递给部件 Init 函数的初始化参数。
 * @param {Object} [functions] - 用于自定义加载和初始化过程的可选函数。
 * @param {() => string} [functions.pathGetter] - 获取部件路径的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Loader] - 从路径加载部件的函数。默认为 baseMjsPartLoader 并调用 part.Load。
 * @param {(part: T) => void} [functions.afterLoad] - 部件加载后调用的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Initer] - 从路径初始化部件的函数。默认为 baseMjsPartLoader 并调用 part.Init。
 * @param {(part: T) => void} [functions.afterInit] - 部件初始化后调用的函数。
 * @returns {Promise<FullProxy<T>>} 一个解析为加载和初始化的部件实例的 FullProxy 的承诺。
 */
export async function loadPart(username, partpath, Initargs, functions) {
	// 记录loadPart调用
	if (isRecordingLoadPartCalls) loadPartCallRecords.add(`${username}:${partpath}`)
	if (!fs.existsSync(GetPartPath(username, partpath) + '/main.mjs')) debugger

	// 支持层级化加载
	const parentPath = path_module.dirname(partpath)
	const partname = path_module.basename(partpath)
	if (parentPath !== '.' && parentPath !== '/')
		try {
			if (fs.existsSync(GetPartPath(username, parentPath) + '/main.mjs')) {
				const parentPart = await loadPart(username, parentPath)
				if (parentPart?.interfaces?.parts?.loadSubPart) {
					const pathGetter = functions?.pathGetter || (() => GetPartPath(username, partpath))
					const my_paths = parentPart.interfaces.parts.getSubPartsInstallPaths([pathGetter()])
					const subPart = await parentPart.interfaces.parts.loadSubPart(my_paths, username, partname)
					if (subPart) return subPart
				}
			}
		} catch (e) { /* ignore parent load error */ }

	return await loadPartBase(username, partpath, Initargs, functions)
}

/**
 *
 */
export const getPartList = getPartListBase

/**
 * 卸载部件的包装函数。处理父部件卸载等细节，然后调用 unloadPartBase。
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {UnloadArgs_t} unLoadargs - 传递给部件 Unload 函数的参数。
 * @param {Object} [options] - 用于自定义卸载过程的可选函数。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(part: T) => Promise<void>} [options.unLoader] - 卸载部件的函数。默认为调用 part.Unload。
 * @param {(path: string, unLoadargs: UnloadArgs_t) => Promise<void>} [options.afterUnload] - 卸载后调用的函数。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
 */
export async function unloadPart(username, partpath, unLoadargs, options) {
	// 尝试委托给父部件
	const parentPath = path_module.dirname(partpath)
	const partname = path_module.basename(partpath)
	if (parentPath !== '.' && parentPath !== '/')
		try {
			if (isPartLoaded(username, parentPath)) {
				const parentPart = await loadPart(username, parentPath)
				if (parentPart?.interfaces?.parts?.unloadSubPart) {
					const pathGetter = options?.pathGetter || (() => GetPartPath(username, partpath))
					await parentPart.interfaces.parts.unloadSubPart([pathGetter()], username, partname)
					return
				}
			}
		} catch (e) { /* ignore */ }

	return await unloadPartBase(username, partpath, unLoadargs, options)
}

/**
 * 获取已加载的部件列表。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 可选的父部件路径，用于过滤。
 * @returns {string[]} 已加载部件路径的数组。
 */
export function getLoadedPartList(username, partpath) {
	if (!parts_set[username]) return []
	const loadedParts = Object.keys(parts_set[username])
	if (!partpath) return loadedParts
	const prefix = partpath + '/'
	return loadedParts.filter(path => path === partpath || path.startsWith(prefix))
}

/**
 * 重新加载一个部件。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {Promise<any>} 一个解析为重新加载的部件实例的承诺。
 */
export async function reloadPart(username, partpath) {
	setTimeout(restartor, 1000).unref() // 我们将重新启动整个服务器，因为 deno 不支持单个 js 文件的热重载
	/*
	await unloadPartBase(username, partpath)
	return await loadPartBase(username, partpath)
	*/
}

/**
 * 加载部件的基本函数，使用提供的或默认的路径获取器和加载器。
 * 如果部件已加载，则返回现有实例。
 *
 * @async
 * @template T
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {Object} [options] - 加载的可选配置。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(path: string) => Promise<T>} [options.Loader=baseMjsPartLoader] - 从路径加载部件的函数。
 * @returns {Promise<T>} 一个解析为加载的部件实例的承诺。
 */
export async function baseloadPart(username, partpath, {
	pathGetter = () => GetPartPath(username, partpath),
	Loader = baseMjsPartLoader,
} = {}) {
	if (isPartLoaded(username, partpath)) return parts_set[username][partpath]
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
		// 默认组件更新：在载入前自 __dirname + '/default/templates/user/' + partpath 同步文件
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
		delete parts_details_cache[partpath]
		saveData(username, 'parts_details_cache')
		throw e
	})
}
/**
 * 浅加载所有的默认部件，以此实现默认部件的快速启动
 * @param {object | string} user - 用户对象或用户名。
 * @returns {Promise<void>}
 */
async function shallowLoadDefaultPartsForUser(user) {
	if (Object(user) instanceof String) user = getUserByUsername(user)
	const defaultParts = user.defaultParts ??= {}
	for (const parent in defaultParts)
		for (const child of defaultParts[parent] ?? [])
			await baseloadPart(user.username, parent + '/' + child).catch(_ => 0)
}
/**
 * 浅加载所有用户的默认部件，以此实现默认部件的快速启动
 * @returns {Promise<void>}
 */
export async function shallowLoadAllDefaultParts() {
	for (const user of Object.values(getAllUsers())) await shallowLoadDefaultPartsForUser(user)
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
 * 记录loadPart调用的集合。
 * @type {Set<string>}
 */
const loadPartCallRecords = new Set()

/**
 * 是否启用loadPart调用记录。
 * @type {boolean}
 */
let isRecordingLoadPartCalls = false

/**
 * 启用loadPart调用记录。
 * @returns {void}
 */
export function enableLoadPartRecording() {
	isRecordingLoadPartCalls = true
	loadPartCallRecords.clear()
}

/**
 * 禁用loadPart调用记录。
 * @returns {void}
 */
export function disableLoadPartRecording() {
	isRecordingLoadPartCalls = false
	loadPartCallRecords.clear()
}

/**
 * 获取记录的loadPart调用列表。
 * @returns {string[]} 记录的调用列表，格式为 "username:partpath"。
 */
export function getLoadPartCallRecords() {
	return Array.from(loadPartCallRecords)
}

/**
 * 清除记录的loadPart调用。
 * @returns {void}
 */
export function clearLoadPartCallRecords() {
	loadPartCallRecords.clear()
}

/**
 * 加载和初始化部件的基础函数。处理初始化和加载生命周期。
 * 此函数只负责加载给定的层级，不处理记录调用或父部件加载等细节。
 * 使用模板参数来指定部件类型和初始化参数，以获得更好的类型安全。
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {Initargs_t} Initargs - 传递给部件 Init 函数的初始化参数。
 * @param {Object} [functions] - 用于自定义加载和初始化过程的可选函数。
 * @param {() => string} [functions.pathGetter] - 获取部件路径的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Loader] - 从路径加载部件的函数。默认为 baseMjsPartLoader 并调用 part.Load。
 * @param {(part: T) => void} [functions.afterLoad] - 部件加载后调用的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [functions.Initer] - 从路径初始化部件的函数。默认为 baseMjsPartLoader 并调用 part.Init。
 * @param {(part: T) => void} [functions.afterInit] - 部件初始化后调用的函数。
 * @returns {Promise<FullProxy<T>>} 一个解析为加载和初始化的部件实例的 FullProxy 的承诺。
 */
export async function loadPartBase(username, partpath, Initargs, {
	pathGetter = () => GetPartPath(username, partpath),
	Loader = async (path, Initargs) => {
		try {
			const part = await baseMjsPartLoader(path)
			await part.Load?.(Initargs)
			return part
		}
		catch (e) {
			await baseMjsPartUnloader(path).catch(() => 0)
			throw e
		}
	},
	afterLoad = part => { },
	Initer = async (path, Initargs) => {
		const part = await baseMjsPartLoader(path)
		await part.Init?.(Initargs)
		notifyPartInstall(username, partpath)
		return part
	},
	afterInit = part => { },
} = {}) {
	Initargs = {
		router: getPartRouter(username, partpath),
		username,
		...Initargs
	}
	parts_set[username] ??= {}
	const parts_init = loadData(username, 'parts_init')
	const parts_config = loadData(username, 'parts_config')
	try {
		if (!parts_init[partpath]) {
			const profile = await doProfile(async () => {
				parts_init[partpath] = initPart(username, partpath, Initargs, { pathGetter, Initer, afterInit })
				parts_init[partpath] = await parts_init[partpath]
			})
			console.logI18n('fountConsole.partManager.partInited', {
				partpath
			})
			console.log(profile)
			parts_init[partpath] = true
			saveData(username, 'parts_init')
		}
		if (parts_init[partpath] instanceof Promise)
			parts_init[partpath] = await parts_init[partpath]
		if (!parts_set[username][partpath]) {
			const profile = await doProfile(async () => {
				parts_set[username][partpath] = (async () => {
					/** @type {T} */
					const part = await baseloadPart(username, partpath, {
						pathGetter,
						/**
						 * 从指定路径加载部件。
						 * @param {string} path - 部件路径。
						 * @returns {Promise<any>} 加载的部件。
						 */
						Loader: async path => await Loader(path, Initargs)
					})
					try {
						await part.interfaces?.config?.SetData?.(parts_config[partpath] ?? {})
					}
					catch (error) {
						console.error(`Failed to set data for part ${partpath}: ${error.message}\n${error.stack}`)
					}
					await afterLoad(part)
					return part
				})()
				parts_set[username][partpath] = await parts_set[username][partpath]
			})
			console.logI18n('fountConsole.partManager.partLoaded', {
				partpath
			})
			console.log(profile)
			events.emit('part-loaded', { username, partpath })
		}
		if (parts_set[username][partpath] instanceof Promise)
			parts_set[username][partpath] = await parts_set[username][partpath]
	}
	finally {
		setDefaultStuff()
	}
	parts_load_results[username] ??= {}
	return parts_load_results[username][partpath] ??= new FullProxy(() => parts_set[username][partpath])
}

/**
 * 初始化一个部件。此函数与 `loadPartBase` 分离，以便在不重新加载的情况下重新初始化。
 *
 * @async
 * @template T
 * @template Initargs_t
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {Initargs_t} Initargs - 初始化参数。
 * @param {Object} [options] - 用于自定义初始化过程的可选函数。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(path: string, Initargs: Initargs_t) => Promise<T>} [options.Initer] - 从路径初始化部件的函数。默认为 baseMjsPartLoader 并调用 part.Init。
 * @param {(part: T) => void} [options.afterInit] - 部件初始化后调用的函数。
 * @returns {Promise<void>}
 */
export async function initPart(username, partpath, Initargs, {
	pathGetter = () => GetPartPath(username, partpath),
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
 * 从内存中卸载一个部件的基础函数，如果存在，则调用其 Unload 函数。
 * 此函数只负责卸载给定的层级，不处理父部件卸载等细节。
 *
 * @async
 * @template T
 * @template UnloadArgs_t
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {UnloadArgs_t} unLoadargs - 传递给部件 Unload 函数的参数。
 * @param {Object} [options] - 用于自定义卸载过程的可选函数。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(part: T) => Promise<void>} [options.unLoader] - 卸载部件的函数。默认为调用 part.Unload。
 * @param {(path: string, unLoadargs: UnloadArgs_t) => Promise<void>} [options.afterUnload] - 卸载后调用的函数。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
 */
export async function unloadPartBase(username, partpath, unLoadargs, {
	pathGetter = () => GetPartPath(username, partpath),
	unLoader = part => part.Unload?.(unLoadargs),
	afterUnload = baseMjsPartUnloader
} = {}) {
	/** @type {T} */
	const part = parts_set[username]?.[partpath]
	if (!part) return
	try {
		await unLoader(part)
		await deletePartRouter(username, partpath)
	}
	catch (error) {
		console.error(error)
	}
	await afterUnload(pathGetter(), unLoadargs)
	delete parts_set[username][partpath]
	if (!Object.keys(parts_set[username]).length) delete parts_set[username]
	delete parts_load_results[username][partpath]
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
 * @param {string} partpath - 部件的路径。
 * @param {UnloadArgs_t} unLoadargs - 传递给部件 Unload 函数的参数。
 * @param {UninstallArgs_t} uninstallArgs - 传递给部件 Uninstall 函数的参数。
 * @param {Object} [options] - 用于自定义卸载过程的可选函数。
 * @param {(path: string) => Promise<T>} [options.Loader] - 从路径加载部件的函数（如果在卸载时部件尚未加载，则使用）。
 * @param {(part: T) => Promise<void>} [options.unLoader] - 卸载部件的函数。默认为调用 part.Unload。
 * @param {() => string} [options.pathGetter] - 获取部件路径的函数。
 * @param {(part: T, path: string) => Promise<void>} [options.Uninstaller] - 卸载部件的函数。默认为调用 part.Uninstall 并删除目录。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
 */
export async function uninstallPartBase(username, partpath, unLoadargs, uninstallArgs, {
	Loader = baseMjsPartLoader,
	unLoader = part => part.Unload?.(unLoadargs),
	pathGetter = () => GetPartPath(username, partpath),
	Uninstaller = async (part, path) => {
		await part?.Uninstall?.(uninstallArgs)
		try {
			await trash(path)
		}
		catch (error) {
			console.error(error)
			fs.rmSync(path, { recursive: true, force: true })
		}
	}
} = {}) {
	parts_set[username] ??= {}
	/** @type {T | undefined} */
	let part = parts_set[username][partpath]
	const parent = path_module.dirname(partpath)
	const partname = path_module.basename(partpath)
	if (getAllDefaultParts(username, parent).includes(partname))
		unsetDefaultPart(username, parent, partname)
	try {
		await unloadPartBase(username, partpath, unLoadargs, { unLoader })
	} catch (error) { console.error(error) }
	try {
		part ??= await baseloadPart(username, partpath, { Loader, pathGetter })
	} catch (error) { console.error(error) }
	await Uninstaller(part, pathGetter())
	events.emit('part-uninstalled', { username, partpath })
	sendEventToUser(username, 'part-uninstalled', { partpath })
	delete parts_set[username]?.[partpath]
	const parts_details_cache = loadData(username, 'parts_details_cache')
	delete parts_details_cache[partpath]
	saveData(username, 'parts_details_cache')
	const parts_config = loadData(username, 'parts_config')
	delete parts_config[partpath]
	saveData(username, 'parts_config')
	const parts_init = loadData(username, 'parts_init')
	delete parts_init[partpath]
	saveData(username, 'parts_init')
	invalidatePartBranchesCache(username)
}

/**
 * 获取给定用户和部件路径的子部件列表。
 *
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 父部件的路径。
 * @param {Object} [options] - 部件列表的可选过滤器和映射器。
 * @param {(file: fs.Dirent) => boolean} [options.PathFilter] - 过滤目录条目的函数。默认为检查具有“main.mjs”的目录。
 * @param {(file: fs.Dirent) => string} [options.ResultMapper] - 将目录条目映射到结果的函数。默认为返回文件名。
 * @returns {string[]} 部件名称数组。
 */
export function getPartListBase(username, partpath, {
	PathFilter = file => fs.existsSync(file.parentPath + '/' + file.name + '/main.mjs'),
	ResultMapper = file => file.name
} = {}) {
	const userRoot = getUserDictionary(username)
	const part_dir = userRoot + '/' + partpath
	let public_dir

	let partlist = []
	if (fs.existsSync(part_dir) && fs.statSync(part_dir).isDirectory())
		partlist = fs.readdirSync(part_dir, { withFileTypes: true }).filter(PathFilter)

	try {
		public_dir = __dirname + '/src/public/parts/' + partpath
		if (fs.existsSync(public_dir)) {
			const publiclist = fs.readdirSync(public_dir, { withFileTypes: true }).filter(PathFilter)
			const currentNames = new Set(partlist.map(f => f.name))
			for (const file of publiclist)
				if (!currentNames.has(file.name))
					partlist.push(file)
		}
	} catch { }

	return partlist.map(ResultMapper)
}

/**
 * 获取部件的基本详细信息，而不使用缓存。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {Promise<object>} 一个解析为部件详细信息的承诺。
 */
async function nocacheGetPartBaseDetails(username, partpath) {
	const parts_details_cache = loadData(username, 'parts_details_cache')
	try {
		let part = await baseloadPart(username, partpath)
		let info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
		if (!info) {
			part = await loadPart(username, partpath).catch(() => part)
			info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
		}
		try {
			return parts_details_cache[partpath] = {
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
					name: path_module.basename(partpath),
					avatar: 'https://api.iconify.design/line-md/emoji-frown-open.svg',
					description: 'error loading part',
					description_markdown: `# error loading part\n\n\`\`\`\`ansi\n${error.message}\n${error.stack}\n\`\`\`\``,
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
 * @param {string} partpath - 部件的路径。
 * @param {boolean} [nocache=false] - 如果为 true，则绕过缓存并强制加载部件。
 * @returns {Promise<PartDetails>} 一个解析为详细部件信息的承诺。
 */
export async function getPartDetails(username, partpath, nocache = false) {
	/** @type {PartDetails | undefined} */
	let details = nocache ? undefined : loadData(username, 'parts_details_cache')?.[partpath]
	const user = getUserByUsername(username)
	if (!details) details = await nocacheGetPartBaseDetails(username, partpath)
	else if (isPartLoaded(username, partpath)) await Promise.any([
		nocacheGetPartBaseDetails(username, partpath).then(result => details = result),
		new Promise(resolve => setTimeout(resolve, 500)),
	])
	let info = getLocalizedInfo(details.info, user.locales)
	if (user.sfw) info = getSfwInfo(info)

	return { ...details, info }
}

/**
 * 获取给定用户和部件路径的所有缓存部件详细信息。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {Promise<{cachedDetails: object, uncachedNames: string[]}>} 一个解析为包含缓存的详细信息和未缓存的名称的对象的承诺。
 */
export async function getAllCachedPartDetails(username, partpath) {
	// 1. Get the full list of part names in this path
	const allPartNames = getPartList(username, partpath)
	const allPartPaths = allPartNames.map(name => partpath ? partpath + '/' + name : name)
	const allPartPathsSet = new Set(allPartPaths)

	// 2. Get cached details
	const detailsCache = loadData(username, 'parts_details_cache') || {}
	const user = getUserByUsername(username)
	const cachedDetails = {}

	// 3. Process cached parts (same logic as before)
	const promises = Object.keys(detailsCache).map(async (cachedPath) => {
		// Filter only parts that are children of the requested path
		// Basically, we check if the cached entry is in the list we found
		if (!allPartPathsSet.has(cachedPath)) return

		let details = detailsCache[cachedPath]
		if (isPartLoaded(username, cachedPath))
			await Promise.any([
				nocacheGetPartBaseDetails(username, cachedPath).then(result => details = result),
				new Promise(resolve => setTimeout(resolve, 500)),
			])

		let info = getLocalizedInfo(details.info, user.locales)
		if (user.sfw) info = getSfwInfo(info)

		// Return keyed by NAME, not full path, to likely match frontend expectations for a list
		const name = path_module.basename(cachedPath)
		cachedDetails[name] = { ...details, info }
	})

	await Promise.all(promises)

	// 4. Determine uncached names
	const uncachedNames = allPartNames.filter(name => !cachedDetails[name])

	// 5. Return the new structure
	return { cachedDetails, uncachedNames }
}
