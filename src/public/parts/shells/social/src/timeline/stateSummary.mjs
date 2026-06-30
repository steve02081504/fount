import { createHash } from 'node:crypto'

import { canonicalStringify } from '../../../../../../scripts/p2p/canonical_json.mjs'
import { findLastEventOfType } from '../../../../../../scripts/p2p/dag/event_query.mjs'
import { readJsonl } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { socialPostKey } from '../../../../../../scripts/p2p/social/post_key.mjs'
import { timelineEventsPath } from '../paths.mjs'

import { commitTimelineEvent } from './append.mjs'

/**
 * @param {object} view 物化时间线视图
 * @param {string} entityHash 时间线 owner
 * @param {string} tipId DAG tip 事件 id
 * @returns {object} state_summary content
 */
export function buildSocialStateSummaryContent(view, entityHash, tipId) {
	const owner = String(entityHash).toLowerCase()
	const following = [...view.following || []].map(h => String(h).toLowerCase()).sort()
	const postKeys = [...view.posts || []].map(p => socialPostKey(owner, p.postId)).sort()
	return {
		tipId,
		followingHash: createHash('sha256').update(canonicalStringify(following)).digest('hex'),
		postIndexHash: createHash('sha256').update(canonicalStringify(postKeys)).digest('hex'),
		materializedAt: Date.now(),
	}
}

/**
 * 物化维护后按需追加 owner 签名的 state_summary。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {object} view 物化视图
 * @param {string} tipId checkpoint tip
 * @param {object[]} [eventsHint] 已加载事件，避免重复读盘
 * @returns {Promise<object | null>} 新事件或 null
 */
export async function maybeAppendSocialStateSummary(username, entityHash, view, tipId, eventsHint = null) {
	const events = eventsHint ?? await readJsonl(timelineEventsPath(username, entityHash))
	const last = findLastEventOfType(events, 'state_summary')
	const minInterval = 50_000
	if (last && events.length - last.index < minInterval) return null
	const content = buildSocialStateSummaryContent(view, entityHash, tipId)
	return commitTimelineEvent(username, entityHash, {
		type: 'state_summary',
		content,
	}, { fanout: false })
}
