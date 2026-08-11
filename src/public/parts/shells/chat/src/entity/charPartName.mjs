/**
 * 【文件】entity/charPartName.mjs
 * 【职责】把用户/API 传入的角色名解析成 chars/ 真实目录名（唯一大小写折叠点）。
 * 【原理】对 getPartList(username, 'chars') 做大小写不敏感匹配，返回列表中的原串。
 * 【数据结构】part 名字符串。
 * 【关联】ensureAgentEntityIdentity、materializeFriendBinding、addchar 等写入路径。
 */
import { getPartList } from '../../../../../../server/parts_loader.mjs'

import { resolveCharPartNameAgainstList } from './charPartNameMatch.mjs'

/** 纯函数：相对已知 chars 名列表解析目录名。 */
export { resolveCharPartNameAgainstList } from './charPartNameMatch.mjs'

/**
 * 解析为本机 chars/ 真实目录名。
 * @param {string} username fount 登录名
 * @param {string} raw 用户/API 输入
 * @returns {string} 真实目录名
 */
export function resolveCharPartName(username, raw) {
	return resolveCharPartNameAgainstList(raw, getPartList(username, 'chars'))
}
