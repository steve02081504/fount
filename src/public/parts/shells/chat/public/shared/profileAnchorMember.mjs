/**
 * 【文件】public/shared/profileAnchorMember.mjs
 * 【职责】资料卡锚点 → 群成员行匹配（悬停/点击共用）。
 * 【原理】按 entityHash / memberKey / pubKeyHash 查找；右侧键为空时不得用 `=== undefined` 误匹配全体无公钥成员。
 */

/**
 * 从群成员表解析资料卡锚点对应的成员行。
 * @param {object[]} members 群成员
 * @param {{ displayKey: string, memberKey?: string | null, authorHash?: string | null }} keys 锚点键
 * @returns {object | undefined} 命中成员；无则 undefined
 */
export function findMemberForProfileAnchor(members, { displayKey, memberKey, authorHash }) {
	if (!displayKey) return undefined
	return members.find(m => {
		if (m.entityHash === displayKey || m.memberKey === displayKey) return true
		const pubKeyHash = m.pubKeyHash
		if (!pubKeyHash) return false
		return pubKeyHash === displayKey
			|| (!!memberKey && pubKeyHash === memberKey)
			|| (!!authorHash && pubKeyHash === authorHash)
	})
}
