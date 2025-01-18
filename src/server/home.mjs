import { loadJsonFile } from '../scripts/json_loader.mjs'
import { getPartListBase, GetPartPath } from './parts_loader.mjs'
import { loadTempData } from './setting_loader.mjs'

// 遍历shell中的home_registry.json文件，获取home_function_buttons和home_char_interfaces
/*
例子：
{
	"home_function_buttons": [ // 这将显示在主页的功能按钮中
		{
			info: {
				zh-CN: {
					title: "浏览所有聊天记录",
				}
			},
			level: 0, // level越高，优先级越高
			url: "/shells/chat/list",
			onclick: "window.open('/shells/chat/list')", //可选的自定义点击事件，如果不写则默认使用window.open到url
			button: "<img src=\"https://example.com/icon.png\" />", //可选的自定义按钮，如果不写，则默认使用一个问号图标
		}
	],
	"home_char_interfaces": [ // 这将显示在主页的每个角色的界面中（假若该角色支持目标interface）
		{
			info: {
				zh-CN: {
					title: "聊天",
				}
			},
			level: 0,
			interface: "chat",
			url: "/shells/chat/new?char=${charname}", //这里的charname是约定的宏，由前端完成替换
			onclick: "window.open('/shells/chat/new?char=${charname}')", //可选的自定义点击事件，如果不写则默认使用window.open到url
			button: "<img src=\"https://example.com/icon.png\" />", //可选的自定义按钮，如果不写，则默认使用一个问号图标
		}
	]
}
*/
export async function loadHomeRegistry(username) {
	let user_home_registry = loadTempData(username, 'home_registry')
	user_home_registry.home_function_buttons ??= {}
	user_home_registry.home_char_interfaces ??= {}
	let shell_list = await getPartListBase(username, 'shells')
	for (let shell of shell_list)
		try {
			let home_registry = loadJsonFile(GetPartPath(username, 'shells', shell) + '/home_registry.json')
			user_home_registry.home_function_buttons[shell] = home_registry.home_function_buttons
			user_home_registry.home_char_interfaces[shell] = home_registry.home_char_interfaces
		} catch (e) { }
}

/**
 * 展开 home_registry 的内容，以供前端使用。
 * @param {string} username - 用户名
 * @returns {Promise<{home_function_buttons: object[], home_char_interfaces: object[]}>} - 展开后的注册内容
 */
export async function expandHomeRegistry(username) {
	let user_home_registry = loadTempData(username, 'home_registry')
	if (!Object.keys(user_home_registry).length) await loadHomeRegistry(username)
	return {
		home_function_buttons: Object.values(user_home_registry.home_function_buttons).flat().sort((a, b) => a.level - b.level),
		home_char_interfaces: Object.values(user_home_registry.home_char_interfaces).flat().sort((a, b) => a.level - b.level)
	}
}
