/**
 * 接口加载器：获取角色的 ideIntegration 接口。
 * 沿用 discordbot 的 char.interfaces 检查模式：
 * - 若角色提供了 char.interfaces.ideIntegration，直接使用
 * - 否则创建默认接口并缓存到 char.interfaces.ideIntegration
 */
import { loadPart } from '../../../../../server/parts_loader.mjs'

import { createDefaultIDEInterface } from './default_interface/main.mjs'

/**
 * 获取角色的 IDE 集成接口。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色 id。
 * @returns {Promise<{ SetupSession?: Function, Reply: Function, TeardownSession?: Function, SetSessionConfigOption?: Function, SetSessionMode?: Function }>} IDE 接口。
 */
export async function getIDEInterface(username, charname) {
	const char = await loadPart(username, 'chars/' + charname)
	if (!char?.interfaces?.chat?.GetReply)
		throw new Error('char does not support GetReply')

	return char.interfaces.ideIntegration ??= await createDefaultIDEInterface(char, username, charname)
}
