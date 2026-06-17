/**
 * DAG 事件列表查询辅助。
 */

/**
 * @param {object[]} events 事件列表
 * @param {string} type 事件类型
 * @returns {{ event: object, index: number } | null} 自后向前最近一条
 */
export function findLastEventOfType(events, type) {
	for (let index = events.length - 1; index >= 0; index--)
		if (events[index]?.type === type) return { event: events[index], index }

	return null
}
