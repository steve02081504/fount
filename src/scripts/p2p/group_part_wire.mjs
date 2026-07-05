import { attachPartWire } from './part_wire_ingress.mjs'
import { isPlainObject } from './wire_ingress.mjs'

/**
 * @param {unknown} data part_invoke 载荷
 * @param {string} groupId 群 ID
 * @returns {object | null} 校验通过后的载荷
 */
function assertGroupContext(data, groupId) {
	if (!isPlainObject(data)) return null
	if (data.groupId !== groupId) return null
	return data
}

/**
 * @param {import('./part_wire_ingress.mjs').PartWireAdapter} wire 底层适配器
 * @param {string} groupId 群 ID
 * @returns {import('./part_wire_ingress.mjs').PartWireAdapter['on']} 注入 groupId 的 on 包装
 */
function wrapWireOn(wire, groupId) {
	return (name, handler) => {
		wire.on(name, (data, peerId) => {
			const payload = assertGroupContext(data, groupId)
			if (!payload) return
			handler(payload, peerId)
		})
	}
}

/**
 * 群联邦房间挂载 part_wire（要求线载荷带 `groupId`）。
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {string} groupId 群 ID
 * @param {import('./part_wire_ingress.mjs').PartWireAdapter} wire Trystero 适配器
 * @param {{ allowPartInvoke?: (payload: object) => boolean }} [options] 入站过滤
 * @returns {void}
 */
export function attachGroupPartWire(ctx, groupId, wire, options = {}) {
	attachPartWire(ctx, {
		send: wire.send.bind(wire),
		on: wrapWireOn(wire, groupId),
	}, options)
}
