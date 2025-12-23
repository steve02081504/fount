import fs from 'node:fs'
import path from 'node:path'

import { loadJsonFile } from '../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../server/auth.mjs'
import { __dirname } from '../../../../../server/base.mjs'
import { GetPartPath, getPartList } from '../../../../../server/parts_loader.mjs'
import { loadTempData } from '../../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../../server/web_server/event_dispatcher.mjs'

import { processButtonList } from './registry_processor.mjs'

/*
遍历shell中的home_registry.json文件，获取home_function_buttons和home_char_interfaces
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
			url: "/parts/shells:chat/list",
			onclick: "window.open('/parts/shells:chat/list')", //可选的自定义点击事件，如果不写则默认href为url
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
			url: "/parts/shells:chat/new?char=${name}", //这里的name是约定的宏，由前端完成替换
			onclick: "window.open('/parts/shells:chat/new?char=${name}')", //可选的自定义点击事件，如果不写则默认href为url
			button: "<img src=\"https://example.com/icon.png\" />", //可选的自定义按钮，如果不写，则默认使用一个问号图标
		}
	]
}
*/

/**
 * 可用的按钮类型
 */
const buttonTypes = [
	'home_function_buttons',
	'home_drag_in_handlers',
	'home_drag_out_generators',
]

/**
 * 动态获取所有根部件类型。
 * @param {string} username - 用户名。
 * @returns {string[]} 根部件类型列表。
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
			const entries = fs.readdirSync(root, { withFileTypes: true })
			for (const entry of entries)
				if (entry.isDirectory()) {
					const partPath = path.join(root, entry.name)
					// 检查是否有 fount.json，表示这是一个部件类型根目录
					if (fs.existsSync(path.join(partPath, 'fount.json')))
						rootTypes.add(entry.name)
				}
		} catch (error) {
			// 忽略读取错误
		}
	}

	return Array.from(rootTypes).sort()
}

/**
 * 为指定部件更新主页注册表。
 * 如果部件目录中存在 home_registry.json，则加载其内容并更新用户的临时主页注册表。
 * 否则，从此注册表中删除该部件的条目。
 * @param {string} username - 用户的唯一标识符。
 * @param {string} partpath - 部件的路径（例如 'chars/GentianAphrodite'）。
 */
function updateHomeRegistryForPart(username, partpath) {
	const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
	const user_home_registry = loadTempData(username, 'home_registry')
	const dirPath = GetPartPath(username, normalizedPartpath)
	const registryPath = dirPath + '/home_registry.json'
	const partname = normalizedPartpath.split('/').slice(1).join('/')

	if (fs.existsSync(registryPath)) try {
		const home_registry = loadJsonFile(registryPath)
		for (const type of buttonTypes)
			(user_home_registry[type] ??= {})[partname] = home_registry[type] ?? []
		const interfaces = home_registry.home_interfaces || {}
		for (const [key, list] of Object.entries(interfaces)) {
			if (!Array.isArray(list)) continue
			((user_home_registry.home_interfaces ??= {})[key] ??= []).push(...list)
		}
	} catch (e) {
		console.error(`Error loading home registry from ${normalizedPartpath}:`, e)
	}
	else removeHomeRegistryForPart(username, normalizedPartpath)
}

/**
 * 从主页注册表中为指定部件删除条目。
 * @param {string} username - 用户的唯一标识符。
 * @param {string} partpath - 部件的路径（例如 'chars/GentianAphrodite'）。
 */
function removeHomeRegistryForPart(username, partpath) {
	const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
	const partname = normalizedPartpath.split('/').slice(1).join('/')
	const user_home_registry = loadTempData(username, 'home_registry')
	for (const type of buttonTypes)
		delete user_home_registry[type]?.[partname]
	// 接口的合并为全局，不按部件删除
}

/**
 * 为用户加载并初始化主页注册表。
 * 这将确保所有必要的注册表键都已设置，并从所有已安装的部件中加载它们的注册表数据。
 * @param {string} username - 用户的唯一标识符。
 * @returns {Promise<void>}
 */
/**
 * 递归扫描部件路径及其子路径来加载 home_registry.json。
 * @param {string} username - 用户的唯一标识符。
 * @param {string} partType - 部件类型。
 * @param {string} partPath - 部件路径（可以是嵌套路径，如 'serviceSources/AI'）。
 * @returns {Promise<void>}
 */
async function scanPartPathForRegistry(username, partType, partPath) {
	// 构建完整的 partpath
	const fullPartpath = partPath ? `${partType}/${partPath}` : partType
	// 检查当前路径是否有 home_registry.json
	updateHomeRegistryForPart(username, fullPartpath)
	// 获取子部件列表并递归扫描
	try {
		const subParts = await getPartList(username, fullPartpath)
		for (const subPart of subParts) {
			const subPath = partPath ? `${partPath}/${subPart}` : subPart
			await scanPartPathForRegistry(username, partType, subPath)
		}
	}
	catch (error) {
		// 如果获取子部件列表失败（例如路径不存在），忽略错误
	}
}

/**
 * 为用户加载并初始化主页注册表。
 * 这将确保所有必要的注册表键都已设置，并从所有已安装的部件中加载它们的注册表数据。
 * @param {string} username - 用户的唯一标识符。
 * @returns {Promise<void>}
 */
export async function loadHomeRegistry(username) {
	const user_home_registry = loadTempData(username, 'home_registry')
	for (const type of buttonTypes)
		user_home_registry[type] ??= {}
	user_home_registry.home_interfaces ??= {}
	// 动态获取所有根部件类型并扫描
	for (const partType of getRootPartTypes(username))
		try {
			const part_list = await getPartList(username, partType)
			for (const part of part_list)
				await scanPartPathForRegistry(username, partType, part)
		}
		catch (error) {
			// 如果获取部件列表失败，继续处理下一个类型
			console.error(`Failed to load parts for type ${partType}:`, error)
		}
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
	/**
	 * 处理接口条目。
	 * @param {object} entries - 接口条目对象。
	 * @returns {object} 处理后的接口对象。
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
 * 在安装 'shell' 部件时触发的回调函数。
 * 更新主页注册表并向用户发送一个事件，以指示注册表已更新。
 * @param {object} params - 事件参数。
 * @param {string} params.username - 用户的用户名。
 * @param {string} params.partpath - 已安装部件的路径。
 * @returns {void}
 */
export function onPartInstalled({ username, partpath }) {
	if (!partpath) return
	updateHomeRegistryForPart(username, partpath)
	sendEventToUser(username, 'home-registry-updated', null)
}

/**
 * 在卸载 'shell' 部件时触发的回调函数。
 * 从主页注册表中删除该部件的条目，并向用户发送一个事件，以指示注册表已更新。
 * @param {object} params - 事件参数。
 * @param {string} params.username - 用户的用户名。
 * @param {string} params.partpath - 已卸载部件的路径。
 * @returns {void}
 */
export function onPartUninstalled({ username, partpath }) {
	if (!partpath) return
	removeHomeRegistryForPart(username, partpath)
	sendEventToUser(username, 'home-registry-updated', null)
}
