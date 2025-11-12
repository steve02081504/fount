import fs from 'node:fs'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { getLocalizedInfo } from '../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../server/auth.mjs'
import { partTypeList } from '../../../../server/managers/base.mjs'
import { getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

import { processButtonList } from './registry_processor.mjs'

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
 * 可用的接口类型
 */
const interfaceTypes = [
	'common', ...partTypeList.map(type => type.slice(0, -1)),
]
/**
 * 可用的按钮类型
 */
const buttonTypes = [
	'home_function_buttons',
	...interfaceTypes.map(type => `home_${type}_interfaces`),
	'home_drag_in_handlers',
	'home_drag_out_generators',
]

/**
 * 为指定部件更新主页注册表。
 * 如果部件目录中存在 home_registry.json，则加载其内容并更新用户的临时主页注册表。
 * 否则，从此注册表中删除该部件的条目。
 * @param {string} username - 用户的唯一标识符。
 * @param {string} parttype - 部件的类型 (例如, 'shells', 'chars')。
 * @param {string} partname - 部件的名称。
 */
function updateHomeRegistryForPart(username, parttype, partname) {
	const user_home_registry = loadTempData(username, 'home_registry')
	const dirPath = GetPartPath(username, parttype, partname)
	const registryPath = dirPath + '/home_registry.json'

	if (fs.existsSync(registryPath)) try {
		const home_registry = loadJsonFile(registryPath)
		for (const type of buttonTypes)
			user_home_registry[type][partname] = home_registry[type] ?? []
	} catch (e) {
		console.error(`Error loading home registry from ${parttype}/${partname}:`, e)
	}
	else removeHomeRegistryForPart(username, parttype, partname)
}

/**
 * 从主页注册表中为指定部件删除条目。
 * @param {string} username - 用户的唯一标识符。
 * @param {string} parttype - 部件的类型 (例如, 'shells', 'chars')。
 * @param {string} partname - 部件的名称。
 */
function removeHomeRegistryForPart(username, parttype, partname) {
	const user_home_registry = loadTempData(username, 'home_registry')
	for (const type of buttonTypes)
		delete user_home_registry[type]?.[partname]
}

/**
 * 为用户加载并初始化主页注册表。
 * 这将确保所有必要的注册表键都已设置，并从所有已安装的 'shells' 部件中加载它们的注册表数据。
 * @param {string} username - 用户的唯一标识符。
 * @returns {Promise<void>}
 */
export async function loadHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	for (const type of buttonTypes)
		user_home_registry[type] ??= {}
	const shell_list = await getPartListBase(username, 'shells')
	for (const shell of shell_list)
		updateHomeRegistryForPart(username, 'shells', shell)
}

/**
 * 展开并本地化主页注册表以供前端使用。
 * 此函数聚合来自不同部件的注册表数据，根据用户区域设置进行本地化，并将其构造成前端期望的格式。
 * @param {string} username - 请求用户的用户名。
 * @returns {Promise<object>} 一个包含格式化后的功能按钮和部件类型定义的对象。
 */
export async function expandHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	if (!Object.keys(user_home_registry).length) await loadHomeRegistry(username)
	const { locales } = getUserByUsername(username)

	/**
	 * 预处理列表，本地化信息并按级别排序。
	 * @param {Array<object>} list - 要处理的按钮列表。
	 * @returns {Array<object>} 预处理后的按钮列表。
	 */
	const base_preprocess = list => list.flat().sort((a, b) => a.level - b.level).map(button => ({
		...button,
		info: getLocalizedInfo(button.info, locales)
	}))

	/**
	 * 预处理接口列表，合并通用接口并本地化信息。
	 * @param {object} list - 接口列表。
	 * @returns {Array<object>} 预处理后的接口列表。
	 */
	const interface_preprocess = list => base_preprocess(
		Object.values(list).concat(Object.values(user_home_registry.home_common_interfaces))
	)

	return {
		home_function_buttons: processButtonList(user_home_registry.home_function_buttons, locales),
		home_drag_in_handlers: processButtonList(user_home_registry.home_drag_in_handlers, locales),
		home_drag_out_generators: processButtonList(user_home_registry.home_drag_out_generators, locales),
		part_types: partTypeList.map(parttame => ({
			name: parttame,
			interfaces: interface_preprocess(user_home_registry[`home_${parttame.slice(0, -1)}_interfaces`] ?? {}),
		})),
	}
}

/**
 * 在安装 'shell' 部件时触发的回调函数。
 * 更新主页注册表并向用户发送一个事件，以指示注册表已更新。
 * @param {object} params - 事件参数。
 * @param {string} params.username - 用户的用户名。
 * @param {string} params.parttype - 已安装部件的类型。
 * @param {string} params.partname - 已安装部件的名称。
 * @returns {void}
 */
export function onPartInstalled({ username, parttype, partname }) {
	if (parttype !== 'shells') return
	updateHomeRegistryForPart(username, parttype, partname)
	sendEventToUser(username, 'home-registry-updated', null)
}

/**
 * 在卸载 'shell' 部件时触发的回调函数。
 * 从主页注册表中删除该部件的条目，并向用户发送一个事件，以指示注册表已更新。
 * @param {object} params - 事件参数。
 * @param {string} params.username - 用户的用户名。
 * @param {string} params.parttype - 已卸载部件的类型。
 * @param {string} params.partname - 已卸载部件的名称。
 * @returns {void}
 */
export function onPartUninstalled({ username, parttype, partname }) {
	if (parttype !== 'shells') return
	removeHomeRegistryForPart(username, parttype, partname)
	sendEventToUser(username, 'home-registry-updated', null)
}
