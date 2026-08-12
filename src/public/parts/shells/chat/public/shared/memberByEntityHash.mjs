/**
 * 【文件】public/shared/memberByEntityHash.mjs
 * 【职责】按 entityHash 主键从群成员表取一行（资料卡锚点 / 纯测试共用）。
 */

/**
 * @param {object[]} members 群成员
 * @param {string} [entityHash] 实体哈希
 * @returns {object | undefined} 命中成员
 */
export function findMemberByEntityHash(members, entityHash) {
	if (!entityHash) return undefined
	return members.find(member => member.entityHash === entityHash)
}
