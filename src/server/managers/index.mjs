import { on_shutdown } from 'npm:on-shutdown'

import { events } from '../events.mjs'
import { getPartListBase, parts_set } from '../parts_loader.mjs'
import { restartor } from '../server.mjs'

import { loadAIsource, loadAIsourceGenerator, unloadAIsource, unloadAIsourceGenerator } from './AIsource_manager.mjs'
import { LoadChar, UnloadChar } from './char_manager.mjs'
import { LoadImportHandler, UnloadImportHandler } from './ImportHandler_manager.mjs'
import { loadPersona, unloadPersona } from './persona_manager.mjs'
import { loadPlugin, unloadPlugin } from './plugin_manager.mjs'
import { loadShell, unloadShell } from './shell_manager.mjs'
import { loadWorld, unloadWorld } from './world_manager.mjs'


const loadMethods = {
	shells: loadShell,
	chars: LoadChar,
	personas: loadPersona,
	worlds: loadWorld,
	AIsources: loadAIsource,
	AIsourceGenerators: loadAIsourceGenerator,
	plugins: loadPlugin,
	ImportHandlers: LoadImportHandler
}
/**
 * 为用户加载一个部件。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {Promise<any>} 一个解析为已加载部件的承诺。
 */
export function loadPart(username, parttype, partname) {
	if (!loadMethods[parttype])
		throw new Error(`Part loader for type "${parttype}" is not registered.`)
	return loadMethods[parttype](username, partname)
}

const pathFilters = {
	/**
	 * 过滤 AI 源文件。
	 * @param {import('fs').Dirent} file - 要过滤的文件。
	 * @returns {boolean} 如果文件是 AI 源，则返回 true，否则返回 false。
	 */
	AIsources: file => file.isFile() && file.name.endsWith('.json')
}
const ResultMappers = {
	/**
	 * 映射 AI 源文件。
	 * @param {import('fs').Dirent} file - 要映射的文件。
	 * @returns {string} AI 源的名称。
	 */
	AIsources: file => file.name.slice(0, -5)
}
/**
 * 获取用户的可用部件列表。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @returns {string[]} 部件名称列表。
 */
export function getPartList(username, parttype) {
	return getPartListBase(username, parttype, {
		PathFilter: pathFilters[parttype],
		ResultMapper: ResultMappers[parttype]
	})
}
/**
 * 获取用户的已加载部件列表。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @returns {string[]} 已加载部件的名称列表。
 */
export function getLoadedPartList(username, parttype) {
	return Object.keys(parts_set[username]?.[parttype] ?? {})
}

const unLoadMethods = {
	shells: unloadShell,
	chars: UnloadChar,
	personas: unloadPersona,
	worlds: unloadWorld,
	AIsources: unloadAIsource,
	AIsourceGenerators: unloadAIsourceGenerator,
	plugins: unloadPlugin,
	ImportHandlers: UnloadImportHandler
}
/**
 * 为用户卸载一个部件。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {Promise<void>} 一个在部件卸载后解析的承诺。
 */
export function unloadPart(username, parttype, partname) {
	return unLoadMethods[parttype](username, partname)
}
on_shutdown(async () => {
	for (const username in parts_set)
		for (const parttype in parts_set[username])
			for (const partname in parts_set[username][parttype])
				await unloadPart(username, parttype, partname)
})

// 事件处理程序
events.on('BeforeUserDeleted', async ({ username }) => {
	for (const parttype in parts_set[username])
		for (const partname in parts_set[username][parttype])
			await unloadPart(username, parttype, partname)
})

events.on('BeforeUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const parttype in parts_set[oldUsername])
		for (const partname in parts_set[oldUsername][parttype])
			await unloadPart(oldUsername, parttype, partname)
})

/**
 * 通过重新启动整个服务器来重新加载部件。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {Promise<void>}
 */
export async function reloadPart(username, parttype, partname) {
	restartor() // 我们将重新启动整个服务器，因为 deno 不支持单个 js 文件的热重载
}
