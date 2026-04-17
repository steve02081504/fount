import { PERMISSION_REGISTRY_ORDER } from './constants.mjs'

/**
 * 已知键按注册表顺序，未知键字典序接在末尾
 *
 * @param {Record<string, boolean>} rec 权限名 → 是否开启
 * @returns {string[]} 稳定排序后的权限键列表
 */
export function sortedPermissionKeys(rec) {
	const known = new Set(PERMISSION_REGISTRY_ORDER)
	const fromReg = [...PERMISSION_REGISTRY_ORDER].filter(k => k in rec)
	const unknown = Object.keys(rec).filter(k => !known.has(k)).sort()
	return [...fromReg, ...unknown]
}

/**
 * Record → BigInt 位图（仅 true 的位为 1）
 *
 * @param {Record<string, boolean>} rec 权限名 → 是否开启
 * @returns {bigint} 按 `sortedPermissionKeys` 顺序编码的位图
 */
export function permissionsToBigInt(rec) {
	let bits = 0n
	const keys = sortedPermissionKeys(rec)
	for (let i = 0; i < keys.length; i++)
		if (rec[keys[i]] === true)
			bits |= 1n << BigInt(i)
	return bits
}

/**
 * 位图解码回权限 Record
 *
 * @param {bigint} bits `permissionsToBigInt` 的输出
 * @param {string[]} keys 与编码时相同顺序的权限名列表
 * @returns {Record<string, boolean>} 权限名 → 是否开启
 */
export function bigIntToPermissions(bits, keys) {
	const out = {}
	for (let i = 0; i < keys.length; i++)
		out[keys[i]] = (bits & (1n << BigInt(i))) !== 0n
	return out
}

/**
 * 最终权限：(∪ roles.permissions | channelAllow) & ~channelDeny
 * ADMIN 短路为全能力 true（按 keys 并集）
 *
 * @param {{
 *   roleRecords: Record<string, boolean>[],
 *   channelAllow?: Record<string, boolean>,
 *   channelDeny?: Record<string, boolean>,
 * }} p 多角色权限与频道覆盖/拒绝规则
 * @returns {Record<string, boolean>} 合并后的有效权限
 */
export function effectivePermissions(p) {
	const { roleRecords, channelAllow = {}, channelDeny = {} } = p
	const keySet = new Set()
	for (const r of roleRecords)
		for (const k of Object.keys(r)) keySet.add(k)
	for (const k of Object.keys(channelAllow)) keySet.add(k)
	for (const k of Object.keys(channelDeny)) keySet.add(k)

	const keys = [...keySet].sort((a, b) => {
		const ia = PERMISSION_REGISTRY_ORDER.indexOf(a)
		const ib = PERMISSION_REGISTRY_ORDER.indexOf(b)
		if (ia !== -1 && ib !== -1) return ia - ib
		if (ia !== -1) return -1
		if (ib !== -1) return 1
		return a.localeCompare(b)
	})

	for (const r of roleRecords)
		if (r.ADMIN === true)
			return Object.fromEntries(keys.map(k => [k, true]))

	let bits = 0n
	for (const r of roleRecords)
		bits |= permissionsToBigInt(r)

	bits |= permissionsToBigInt(channelAllow)
	const deny = permissionsToBigInt(channelDeny)
	bits &= ~deny

	return bigIntToPermissions(bits, keys)
}
