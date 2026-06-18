import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../../../server/auth.mjs'
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
 * @param {string} username
 * @returns {string[]}
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
 * @param {string} username
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
	for (const { data } of interfaceEntries) {
		for (const [key, list] of Object.entries(data || {})) {
			if (!Array.isArray(list)) continue
			((user_home_registry.home_interfaces ??= {})[key] ??= []).push(...list)
		}
	}
}

/**
 * @param {string} username
 * @returns {Promise<object>}
 */
export async function expandHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	await loadHomeRegistry(username)

	/**
	 * @param {object} entries
 * @returns {object}
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
 * @param {object} params
 * @returns {void}
 */
export function onPartInstalled({ username }) {
	sendEventToUser(username, 'home-registry-updated', null)
}

/**
 * @param {object} params
 * @returns {void}
 */
export function onPartUninstalled({ username }) {
	sendEventToUser(username, 'home-registry-updated', null)
}
