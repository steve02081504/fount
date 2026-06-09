/**
 * 加载具备 interfaces.social 的角色 part。
 */
import { loadPart } from '../../../../../../server/parts_loader.mjs'

/**
 * @param {string} username replica 登录名
 * @param {string} charPartName chars/ 目录名
 * @returns {Promise<object>} 已定义 social 接口的 char part
 */
export async function ensureCharSocialInterface(username, charPartName) {
	const char = await loadPart(username, `chars/${charPartName}`)
	if (!char?.interfaces?.social)
		throw new Error(`char ${charPartName} missing interfaces.social`)
	return char
}
