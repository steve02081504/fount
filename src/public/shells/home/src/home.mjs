import fs from 'node:fs'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { getLocalizedInfo } from '../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../server/auth.mjs'
import { getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

// 遍历shell中的home_registry.json文件，获取home_function_buttons和home_char_interfaces
/*
例子：
{
	"home_function_buttons": [ // 这将显示在主页的功能按钮中
		{
			info: {
				"zh-CN": {
					title: "浏览所有聊天记录",
				}
			},
			level: 0, // level越高，优先级越高
			url: "/shells/chat/list",
			onclick: "window.open('/shells/chat/list')", //可选的自定义点击事件，如果不写则默认href为url
			button: "<img src=\"https://example.com/icon.png\" />", //可选的自定义按钮，如果不写，则默认使用一个问号图标
		}
	],
	"home_char_interfaces": [ // 这将显示在主页的每个角色的界面中（假若该角色支持目标interface）
		{
			info: {
				"zh-CN": {
					title: "聊天",
				}
			},
			level: 0,
			interface: "chat",
			url: "/shells/chat/new?char=${name}", //这里的name是约定的宏，由前端完成替换
			onclick: "window.open('/shells/chat/new?char=${name}')", //可选的自定义点击事件，如果不写则默认href为url
			button: "<img src=\"https://example.com/icon.png\" />", //可选的自定义按钮，如果不写，则默认使用一个问号图标
		}
	]
}
*/
/**
 * 更新主页注册表中的部件。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 */
function updateHomeRegistryForPart(username, parttype, partname) {
	const user_home_registry = loadTempData(username, 'home_registry')
	const dirPath = GetPartPath(username, parttype, partname)
	const registryPath = dirPath + '/home_registry.json'

	if (fs.existsSync(registryPath)) try {
		const home_registry = loadJsonFile(registryPath)
		user_home_registry.home_function_buttons[partname] = home_registry.home_function_buttons ?? []
		user_home_registry.home_char_interfaces[partname] = home_registry.home_char_interfaces ?? []
		user_home_registry.home_world_interfaces[partname] = home_registry.home_world_interfaces ?? []
		user_home_registry.home_persona_interfaces[partname] = home_registry.home_persona_interfaces ?? []
		user_home_registry.home_common_interfaces[partname] = home_registry.home_common_interfaces ?? []
	} catch (e) {
		console.error(`Error loading home registry from ${parttype}/${partname}:`, e)
	}
	else removeHomeRegistryForPart(username, parttype, partname)

}

/**
 * 从主页注册表中删除部件。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 */
function removeHomeRegistryForPart(username, parttype, partname) {
	const user_home_registry = loadTempData(username, 'home_registry')
	if (user_home_registry.home_function_buttons) delete user_home_registry.home_function_buttons[partname]
	if (user_home_registry.home_char_interfaces) delete user_home_registry.home_char_interfaces[partname]
	if (user_home_registry.home_world_interfaces) delete user_home_registry.home_world_interfaces[partname]
	if (user_home_registry.home_persona_interfaces) delete user_home_registry.home_persona_interfaces[partname]
	if (user_home_registry.home_common_interfaces) delete user_home_registry.home_common_interfaces[partname]
}

/**
 * 加载主页注册表。
 * @param {string} username - 用户名。
 * @returns {Promise<void>}
 */
export async function loadHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	user_home_registry.home_function_buttons ??= {}
	user_home_registry.home_char_interfaces ??= {}
	user_home_registry.home_world_interfaces ??= {}
	user_home_registry.home_persona_interfaces ??= {}
	user_home_registry.home_common_interfaces ??= {}
	const shell_list = await getPartListBase(username, 'shells')
	for (const shell of shell_list)
		updateHomeRegistryForPart(username, 'shells', shell)
}

/**
 * 展开 home_registry 的内容，以供前端使用。
 * @param {string} username - 用户名
 * @returns {Promise<{home_function_buttons: object[], home_char_interfaces: object[]}>} - 展开后的注册内容
 */
export async function expandHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	if (!Object.keys(user_home_registry).length) await loadHomeRegistry(username)
	const { locales } = getUserByUsername(username)

	/**
	 * 递归本地化项目。
	 * @param {Array<object>} items - 项目。
	 * @returns {Array<object>} - 本地化后的项目。
	 */
	const localizeRecursively = (items) => {
		if (!items) return []
		return items.map(item => ({
			...item,
			info: getLocalizedInfo(item.info, locales),
			sub_items: localizeRecursively(item.sub_items)
		}))
	}

	/**
	 * 预处理列表。
	 * @param {Array<object>} list - 列表。
	 * @returns {Array<object>} - 预处理后的列表。
	 */
	const preprocess = list => {
		const allButtons = localizeRecursively(Object.values(list).flat())

		/**
		 * 合并按钮。
		 * @param {Array<object>} buttonList - 按钮列表。
		 * @returns {Array<object>} - 合并后的按钮列表。
		 */
		const mergeButtons = (buttonList) => {
			if (!buttonList) return []
			const buttonsById = new Map()
			const otherButtons = []

			for (const button of buttonList)
				if (button.id) {
					if (!buttonsById.has(button.id))
						buttonsById.set(button.id, [])

					buttonsById.get(button.id).push(button)
				} else otherButtons.push(button)

			const mergedList = []
			for (const [id, buttonsToMerge] of buttonsById.entries()) {
				const baseButton = JSON.parse(JSON.stringify(buttonsToMerge[0])) // Deep copy
				let allSubItems = baseButton.sub_items || []

				for (let i = 1; i < buttonsToMerge.length; i++) {
					const nextButton = buttonsToMerge[i]
					Object.assign(baseButton.info, nextButton.info) // Merge info
					// Last one wins for other properties
					Object.assign(baseButton, {
						level: nextButton.level ?? baseButton.level,
						button: nextButton.button ?? baseButton.button,
						classes: nextButton.classes ?? baseButton.classes,
						style: nextButton.style ?? baseButton.style,
						action: nextButton.action ?? baseButton.action,
						url: nextButton.url ?? baseButton.url,
					})
					if (nextButton.sub_items)
						allSubItems = allSubItems.concat(nextButton.sub_items)

				}

				if (allSubItems.length)
					baseButton.sub_items = mergeButtons(allSubItems)

				mergedList.push(baseButton)
			}

			return [...mergedList, ...otherButtons]
		}

		const finalButtons = mergeButtons(allButtons)
		finalButtons.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
		return finalButtons
	}

	/**
	 * 基本预处理。
	 * @param {Array<object>} list - 列表。
	 * @returns {Array<object>} - 预处理后的列表。
	 */
	const base_preprocess = list => list.flat().sort((a, b) => a.level - b.level).map(button => ({
		...button,
		info: getLocalizedInfo(button.info, locales)
	}))
	/**
	 * 接口预处理。
	 * @param {Array<object>} list - 列表。
	 * @returns {Array<object>} - 预处理后的列表。
	 */
	const interface_preprocess = list => base_preprocess(Object.values(list).concat(Object.values(user_home_registry.home_common_interfaces)))

	return {
		home_function_buttons: preprocess(user_home_registry.home_function_buttons),
		home_char_interfaces: interface_preprocess(user_home_registry.home_char_interfaces),
		home_world_interfaces: interface_preprocess(user_home_registry.home_world_interfaces),
		home_persona_interfaces: interface_preprocess(user_home_registry.home_persona_interfaces),
	}
}

/**
 * 部件安装时。
 * @param {object} root0 - 参数。
 * @param {string} root0.username - 用户名。
 * @param {string} root0.parttype - 部件类型。
 * @param {string} root0.partname - 部件名称。
 */
export function onPartInstalled({ username, parttype, partname }) {
	if (parttype !== 'shells') return

	updateHomeRegistryForPart(username, parttype, partname)
	sendEventToUser(username, 'home-registry-updated', null)
}

/**
 * 部件卸载时。
 * @param {object} root0 - 参数。
 * @param {string} root0.username - 用户名。
 * @param {string} root0.parttype - 部件类型。
 * @param {string} root0.partname - 部件名称。
 */
export function onPartUninstalled({ username, parttype, partname }) {
	if (parttype !== 'shells') return

	removeHomeRegistryForPart(username, parttype, partname)
	sendEventToUser(username, 'home-registry-updated', null)
}
