/**
 * 通用权限位图编解码。
 */

/**
 * @param {readonly string[]} order 权限名有序列表（位序固定）
 * @returns {{ encode: (permissions: Record<string, boolean> | null | undefined) => bigint, decode: (bits: bigint) => Record<string, boolean> }} codec
 */
export function createPermissionCodec(order) {
	const names = [...order]
	/**
	 * @param {Record<string, boolean> | null | undefined} permissions 权限对象
	 * @returns {bigint} 按位编码
	 */
	function encode(permissions) {
		let bits = 0n
		if (!permissions) return bits
		for (let index = 0; index < names.length; index++)
			if (permissions[names[index]])
				bits |= 1n << BigInt(index)
		return bits
	}
	/**
	 * @param {bigint} bits 权限位
	 * @returns {Record<string, boolean>} 各权限名到布尔值
	 */
	function decode(bits) {
		/** @type {Record<string, boolean>} */
		const permissions = {}
		for (let index = 0; index < names.length; index++)
			permissions[names[index]] = Boolean(bits & (1n << BigInt(index)))
		return permissions
	}
	return { encode, decode }
}
