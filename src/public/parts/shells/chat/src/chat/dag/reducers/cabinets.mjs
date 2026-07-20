import { withGroupId } from './state.mjs'

/**
 * @param {object} state 物化状态
 * @returns {Record<string, object>} 柜绑定表
 */
function ensureCabinets(state) {
	if (!state.cabinets) state.cabinets = {}
	return state.cabinets
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const cabinetReducers = {
	/**
	 * 绑定共享柜到群角色访问矩阵。
	 * @param {object} state 状态
	 * @param {object} event 事件
	 * @returns {object} state
	 */
	cabinet_bind(state, event) {
		withGroupId(state, event)
		const cabinetId = String(event.content?.cabinet_id || '').trim().toLowerCase()
		if (!cabinetId) return state
		const cabinets = ensureCabinets(state)
		cabinets[cabinetId] = {
			cabinet_id: cabinetId,
			name: String(event.content?.name || cabinetId.slice(0, 8)).slice(0, 256),
			write_pubkey: String(event.content?.write_pubkey || ''),
			role_access: event.content?.role_access && typeof event.content.role_access === 'object'
				? { ...event.content.role_access }
				: {},
			bound_at: event.timestamp || Date.now(),
			bound_by: event.sender,
			keyWraps: event.content?.keyWraps || cabinets[cabinetId]?.keyWraps || {},
		}
		return state
	},

	/**
	 * 更新柜密钥 wraps（补授 / 升代）。
	 * @param {object} state 状态
	 * @param {object} event 事件
	 * @returns {object} state
	 */
	cabinet_key_update(state, event) {
		withGroupId(state, event)
		const cabinetId = String(event.content?.cabinet_id || '').trim().toLowerCase()
		if (!cabinetId) return state
		const cabinets = ensureCabinets(state)
		const row = cabinets[cabinetId]
		if (!row) return state
		const incoming = event.content?.keyWraps || {}
		row.keyWraps = { ...row.keyWraps, ...incoming }
		if (event.content?.read_generation != null)
			row.read_generation = Number(event.content.read_generation)
		if (event.content?.name != null)
			row.name = String(event.content.name).slice(0, 256)
		if (event.content?.role_access && typeof event.content.role_access === 'object')
			row.role_access = { ...event.content.role_access }
		return state
	},

	/**
	 * 解绑共享柜。
	 * @param {object} state 状态
	 * @param {object} event 事件
	 * @returns {object} state
	 */
	cabinet_unbind(state, event) {
		withGroupId(state, event)
		const cabinetId = String(event.content?.cabinet_id || '').trim().toLowerCase()
		if (!cabinetId) return state
		delete ensureCabinets(state)[cabinetId]
		return state
	},
}
