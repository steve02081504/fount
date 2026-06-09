/**
 * Chat DAG 事件 wire 净化（剥离本地扩展键，保证 gossip 验签域一致）。
 */
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'

/** @type {(ev: unknown) => object} */
export const sanitizeFederatedEvent = stripDagEventLocalExtensions

/**
 * @param {object[]} events 事件列表
 * @returns {object[]} 净化后的列表
 */
export function sanitizeFederatedEvents(events) {
	return events.map(sanitizeFederatedEvent)
}
