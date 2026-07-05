import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../../../server/auth/index.mjs'
import { __dirname } from '../../../../../server/base.mjs'
import { loadRegistryJsonEntries } from '../../../../../server/registries.mjs'
import { loadTempData } from '../../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../../server/web_server/event_dispatcher.mjs'

import { processButtonList } from './registry_processor.mjs'

const buttonTypes = [
	'home_function_buttons',
	'home_drag_in_handlers',
	'home_drag_out_generators',
]

/**
 * 列出用户可见的顶层 part 类型目录名。
 * @param {string} username - 用户名。
 * @returns {string[]} part 类型名列表。
 */
function getRootPartTypes(username) {
	const rootTypes = new Set()
	const roots = [
		path.join(__dirname, 'src/public/parts'),
		getUserDictionary(username),
	]
	for (const root of roots) {
		if (!fs.existsSync(root)) continue
		try {
			for (const entry of fs.readdirSync(root, { withFileTypes: true }))
				if (entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'fount.json')))
					rootTypes.add(entry.name)
		}
		catch { /* ignore */ }
	}
	return Array.from(rootTypes).sort()
}

/**
 * 从磁盘重建 Home registry 到内存。
 * @param {string} username - 用户名。
 * @returns {Promise<void>}
 */
export async function loadHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	for (const type of buttonTypes)
		user_home_registry[type] = {}
	user_home_registry.home_interfaces = {}

	for (const type of buttonTypes) {
		const loaded = await loadRegistryJsonEntries(username, type)
		for (const { entry, data } of loaded) {
			const partname = entry.partpath?.split('/').slice(1).join('/') || entry.partpath || 'unknown'
			const bucket = user_home_registry[type] ??= {}
			bucket[partname] = Array.isArray(data) ? data : []
		}
	}

	const interfaceEntries = await loadRegistryJsonEntries(username, 'home_interfaces')
	for (const { data } of interfaceEntries) 
		for (const [key, list] of Object.entries(data || {})) {
			if (!Array.isArray(list)) continue
			((user_home_registry.home_interfaces ??= {})[key] ??= []).push(...list)
		}
	
}

/**
 * 展开 Home registry 为前端可用结构。
 * @param {string} username - 用户名。
 * @returns {Promise<object>} 展开后的 registry 对象。
 */
export async function expandHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	await loadHomeRegistry(username)

	/**
	 * 处理 home_interfaces 条目。
	 * @param {object} entries - 接口名到按钮列表的映射。
	 * @returns {object} 处理后的接口映射。
	 */
	const processInterfaces = entries => {
		const result = {}
		for (const [key, list] of Object.entries(entries)) {
			if (!Array.isArray(list)) continue
			result[key] = processButtonList({ _: list })
		}
		return result
	}

	return {
		home_function_buttons: processButtonList(user_home_registry.home_function_buttons),
		home_drag_in_handlers: processButtonList(user_home_registry.home_drag_in_handlers),
		home_drag_out_generators: processButtonList(user_home_registry.home_drag_out_generators),
		home_interfaces: processInterfaces(user_home_registry.home_interfaces),
		part_types: getRootPartTypes(username).map(name => ({ name })),
	}
}

/**
 * 部件安装后通知 Home 前端刷新 registry。
 * @param {object} params - 参数对象。
 * @param {string} params.username - 用户名。
 * @returns {void}
 */
export function onPartInstalled({ username }) {
	sendEventToUser(username, 'home-registry-updated', null)
}

/**
 * 部件卸载后通知 Home 前端刷新 registry。
 * @param {object} params - 参数对象。
 * @param {string} params.username - 用户名。
 * @returns {void}
 */
export function onPartUninstalled({ username }) {
	sendEventToUser(username, 'home-registry-updated', null)
}
