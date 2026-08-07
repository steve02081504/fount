/** Social 关注 / 拉黑 / 隐藏 / 免打扰关系写操作。 */
import { socialRequest } from './client.mjs'

/**
 * 关注或取消关注。
 * @param {string} entityHash 目标实体
 * @param {boolean} value 关注 / 取消关注
 * @returns {Promise<object>} 写入事件
 */
export function follow(entityHash, value) {
	return socialRequest('/relationships/follow', {
		method: 'POST',
		body: JSON.stringify({ entityHash, follow: value }),
	})
}

/**
 * 拉黑或取消拉黑。
 * @param {string} entityHash 目标实体
 * @param {boolean} value 拉黑 / 取消拉黑
 * @returns {Promise<object>} 写入事件
 */
export function block(entityHash, value) {
	return socialRequest('/relationships/block', {
		method: 'POST',
		body: JSON.stringify({ entityHash, block: value }),
	})
}

/**
 * 隐藏或取消隐藏。
 * @param {string} entityHash 目标实体
 * @param {boolean} value 隐藏 / 取消隐藏
 * @returns {Promise<object>} 写入事件
 */
export function hide(entityHash, value) {
	return socialRequest('/relationships/hide', {
		method: 'POST',
		body: JSON.stringify({ entityHash, hide: value }),
	})
}

/**
 * 免打扰或取消免打扰。
 * @param {string} entityHash 目标实体
 * @param {boolean} value 免打扰 / 取消免打扰
 * @returns {Promise<object>} 写入事件
 */
export function mute(entityHash, value) {
	return socialRequest('/relationships/mute', {
		method: 'POST',
		body: JSON.stringify({ entityHash, mute: value }),
	})
}
