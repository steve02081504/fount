/** world_op DAG 事件 content 形状校验（本地与联邦共用）。 */

const WORLD_OPS = new Set(['set', 'del'])

/**
 * @param {object} event DAG 事件
 * @returns {void}
 */
export function validateWorldOpContent(event) {
	const content = event?.content || {}
	const worldname = String(content.worldname || '').trim()
	const op = String(content.op || '').trim()
	const key = String(content.key || '').trim()
	if (!worldname) throw new Error('world_op: worldname required')
	if (!WORLD_OPS.has(op)) throw new Error('world_op: op must be set or del')
	if (!key) throw new Error('world_op: key required')
	if (op === 'set' && content.value === undefined)
		throw new Error('world_op: value required for set')
}
