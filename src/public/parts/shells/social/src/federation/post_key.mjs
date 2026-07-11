import { compositeKey } from '../../../../../../scripts/p2p/composite_key.mjs'

/**
 * Social 帖子/互动 Map 键（entityHash + postId）。
 * @param {string} entityHash 128 hex
 * @param {string} postId 帖子 id
 * @returns {string} 复合键
 */
export function socialPostKey(entityHash, postId) {
	return compositeKey(String(entityHash).toLowerCase(), String(postId))
}
