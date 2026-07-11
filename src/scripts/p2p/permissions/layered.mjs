/**
 * 分层 allow/deny 覆写：先去 deny 再叠 allow。
 */

/**
 * @param {bigint} baseBits 基线权限位
 * @param {{ deny?: Record<string, boolean> | null, allow?: Record<string, boolean> | null }} override 覆写
 * @param {(permissions: Record<string, boolean> | null | undefined) => bigint} encode 编码函数
 * @returns {bigint} 覆写后的权限位
 */
export function applyDenyAllowOverride(baseBits, override, encode) {
	if (!override) return baseBits
	let bits = baseBits
	if (override.deny)
		bits &= ~encode(override.deny)
	if (override.allow)
		bits |= encode(override.allow)
	return bits
}

/**
 * 合并多个角色的 allow/deny 后整体应用（顺序无关）。
 * @param {bigint} baseBits 基线权限位
 * @param {Array<{ deny?: Record<string, boolean> | null, allow?: Record<string, boolean> | null }>} overrides 覆写列表
 * @param {(permissions: Record<string, boolean> | null | undefined) => bigint} encode 编码函数
 * @returns {bigint} 覆写后的权限位
 */
export function mergeRoleOverrides(baseBits, overrides, encode) {
	let roleAllow = 0n
	let roleDeny = 0n
	for (const override of overrides) {
		if (!override) continue
		if (override.allow)
			roleAllow |= encode(override.allow)
		if (override.deny)
			roleDeny |= encode(override.deny)
	}
	return (baseBits & ~roleDeny) | roleAllow
}
