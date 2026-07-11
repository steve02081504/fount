/**
 * Discord 式「按特定度分层」权限求值器工厂。
 */
import { createPermissionCodec } from './bitmask.mjs'
import { applyDenyAllowOverride, mergeRoleOverrides } from './layered.mjs'

/**
 * @typedef {object} LayeredEvaluatorSchema
 * @property {readonly string[]} order 权限名有序列表
 * @property {string} superuserName 旁路全部 scope 覆写的权限名（如 ADMIN）
 * @property {string} [everyoneRoleId='@everyone'] scope 内最宽角色 id
 */

/**
 * @param {LayeredEvaluatorSchema} schema 求值 schema
 * @returns {{
 *   order: readonly string[],
 *   encode: (permissions: Record<string, boolean> | null | undefined) => bigint,
 *   decode: (bits: bigint) => Record<string, boolean>,
 *   calculate: (member: { roles?: string[] }, roles: Record<string, { permissions?: Record<string, boolean> }>, scopeId: string, scopeOverrides: Record<string, Record<string, { deny?: Record<string, boolean>, allow?: Record<string, boolean> }>>) => Record<string, boolean>,
 *   has: (member: object, permission: string, roles: object, scopeId: string, scopeOverrides: object) => boolean,
 * }} evaluator
 */
export function createLayeredEvaluator(schema) {
	const { encode, decode } = createPermissionCodec(schema.order)
	const superuserBit = 1n << BigInt(schema.order.indexOf(schema.superuserName))
	const everyoneRoleId = schema.everyoneRoleId ?? '@everyone'

	/**
	 * @param {{ roles?: string[] }} member 成员
	 * @param {Record<string, { permissions?: Record<string, boolean> }>} roles 角色映射
	 * @param {string} scopeId scope id（如 channelId）
	 * @param {Record<string, Record<string, { deny?: Record<string, boolean>, allow?: Record<string, boolean> }>>} scopeOverrides scope 覆写表
	 * @returns {Record<string, boolean>} 最终权限
	 */
	function calculate(member, roles, scopeId, scopeOverrides) {
		const roleIds = member.roles || []

		let baseBits = 0n
		for (const roleId of roleIds) {
			const role = roles[roleId]
			if (role) baseBits |= encode(role.permissions)
		}

		if (baseBits & superuserBit) {
			/** @type {Record<string, boolean>} */
			const perms = {}
			for (const p of schema.order) perms[p] = true
			return perms
		}

		let bits = baseBits
		const scopeOverride = scopeOverrides?.[scopeId]
		if (scopeOverride) {
			const everyone = scopeOverride[everyoneRoleId]
			if (everyone)
				bits = applyDenyAllowOverride(bits, everyone, encode)

			const roleOverrides = []
			for (const roleId of roleIds) {
				if (roleId === everyoneRoleId) continue
				const override = scopeOverride[roleId]
				if (override) roleOverrides.push(override)
			}
			bits = mergeRoleOverrides(bits, roleOverrides, encode)
		}

		return decode(bits)
	}

	/**
	 * @param {object} member 成员
	 * @param {string} permission 权限名
	 * @param {object} roles 角色映射
	 * @param {string} scopeId scope id
	 * @param {object} scopeOverrides scope 覆写表
	 * @returns {boolean} 是否具备权限
	 */
	function has(member, permission, roles, scopeId, scopeOverrides) {
		return calculate(member, roles, scopeId, scopeOverrides)[permission] === true
	}

	return {
		order: schema.order,
		encode,
		decode,
		calculate,
		has,
	}
}
