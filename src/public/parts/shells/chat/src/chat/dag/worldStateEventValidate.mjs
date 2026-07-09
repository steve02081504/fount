/** world_state DAG 事件 content 形状校验（本地与联邦共用）。 */

const ACTIONS = new Set(['set', 'delete'])

/**
 * @param {object} event DAG 事件
 * @returns {void}
 */
export function validateWorldStateContent(event) {
	const { worldname, action, key, value } = event.content
	if (!worldname?.trim()) throw new Error('world_state: worldname required')
	if (!ACTIONS.has(action)) throw new Error('world_state: action must be set or delete')
	if (!key?.trim()) throw new Error('world_state: key required')
	if (action === 'set' && value === undefined)
		throw new Error('world_state: value required for set')
}
