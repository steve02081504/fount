import fs from 'node:fs'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { getLocalizedInfo } from '../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../server/auth.mjs'
import { getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

const watchedDirs = new Set()
let registryLastChanged = Date.now()

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
export async function loadHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	user_home_registry.home_function_buttons ??= {}
	user_home_registry.home_char_interfaces ??= {}
	user_home_registry.home_world_interfaces ??= {}
	user_home_registry.home_persona_interfaces ??= {}
	user_home_registry.home_common_interfaces ??= {}
	const shell_list = await getPartListBase(username, 'shells')
	for (const shell of shell_list) try {
		const dirPath = GetPartPath(username, 'shells', shell)
		const registryPath = dirPath + '/home_registry.json'
		if (!watchedDirs.has(dirPath)) try {
			fs.watch(dirPath, (eventType, filename) => {
				if (filename !== 'home_registry.json') return
				console.log(`Home registry file changed in dir: ${dirPath}. Invalidating caches on next request.`)
				registryLastChanged = Date.now()
				sendEventToUser(username, 'home-registry-updated', null)
			})
			watchedDirs.add(dirPath)
		} catch (e) {
			console.error(`Failed to set up watch on ${dirPath}:`, e)
		}

		const home_registry = loadJsonFile(registryPath)
		user_home_registry.home_function_buttons[shell] = home_registry.home_function_buttons ?? []
		user_home_registry.home_char_interfaces[shell] = home_registry.home_char_interfaces ?? []
		user_home_registry.home_world_interfaces[shell] = home_registry.home_world_interfaces ?? []
		user_home_registry.home_persona_interfaces[shell] = home_registry.home_persona_interfaces ?? []
		user_home_registry.home_common_interfaces[shell] = home_registry.home_common_interfaces ?? []
	} catch (e) { }
}

/**
 * 展开 home_registry 的内容，以供前端使用。
 * @param {string} username - 用户名
 * @returns {Promise<{home_function_buttons: object[], home_char_interfaces: object[]}>} - 展开后的注册内容
 */
export async function expandHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	if (!user_home_registry.lastLoaded || user_home_registry.lastLoaded < registryLastChanged) {
		// Clear old data from the cache object
		for (const key in user_home_registry)
			delete user_home_registry[key]

		await loadHomeRegistry(username)
		user_home_registry.lastLoaded = Date.now()
	}
	const { locales } = getUserByUsername(username)

	const localizeRecursively = (items) => {
		if (!items) return []
		return items.map(item => ({
			...item,
			info: getLocalizedInfo(item.info, locales),
			sub_items: localizeRecursively(item.sub_items)
		}))
	}

	const preprocess = list => {
		const allButtons = localizeRecursively(Object.values(list).flat())

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

				if (allSubItems.length > 0)
					baseButton.sub_items = mergeButtons(allSubItems)

				mergedList.push(baseButton)
			}

			return [...mergedList, ...otherButtons]
		}

		const finalButtons = mergeButtons(allButtons)
		finalButtons.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
		return finalButtons
	}

	const base_preprocess = list => list.flat().sort((a, b) => a.level - b.level).map(button => ({
		...button,
		info: getLocalizedInfo(button.info, locales)
	}))
	const interface_preprocess = list => base_preprocess(Object.values(list).concat(Object.values(user_home_registry.home_common_interfaces)))

	return {
		home_function_buttons: preprocess(user_home_registry.home_function_buttons),
		home_char_interfaces: interface_preprocess(user_home_registry.home_char_interfaces),
		home_world_interfaces: interface_preprocess(user_home_registry.home_world_interfaces),
		home_persona_interfaces: interface_preprocess(user_home_registry.home_persona_interfaces),
	}
}

export function onPartChanged({ username, parttype, partname }) {
	if (parttype !== 'shells') return

	registryLastChanged = Date.now()
	sendEventToUser(username, 'home-registry-updated', null)
}
