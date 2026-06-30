import { topologicalCanonicalOrder } from '../dag/index.mjs'

/**
 * 拓扑序后按 reducer 表折叠事件列表。
 * @param {object[]} events 原始事件
 * @param {Record<string, (state: object, event: object) => object>} reducers 事件类型 → reducer
 * @param {() => object} createInitialState 初始状态工厂
 * @returns {{ state: object, order: string[] }} 物化结果与拓扑序
 */
export function materializeFromEvents(events, reducers, createInitialState) {
	const order = topologicalCanonicalOrder(events.map(event => ({
		id: event.id,
		prev_event_ids: event.prev_event_ids,
		hlc: event.hlc,
		node_id: event.node_id,
	})))
	const byId = new Map(events.map(event => [event.id, event]))
	let state = createInitialState()
	for (const eventId of order) {
		const event = byId.get(eventId)
		if (!event) continue
		const reducer = reducers[event.type]
		if (reducer) state = reducer(state, event)
	}
	return { state, order }
}
