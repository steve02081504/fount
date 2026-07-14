import { createHash } from 'node:crypto'

import { canonicalStringify } from 'npm:@steve02081504/fount-p2p/core/canonical_json'
import { findLastEventOfType } from 'npm:@steve02081504/fount-p2p/dag/event_query'
import { computeLocalTipsHash, computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/dag/index'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { eventsPath } from '../lib/paths.mjs'

import { appendSignedLocalEvent } from './append.mjs'

/**
 * @param {object} state 物化状态
 * @param {string} anchorEventId checkpoint tip 事件 id
 * @param {object[]} [events] 全量事件（算 tipsHash）
 * @returns {object} state_summary content
 */
export function buildStateSummaryContent(state, anchorEventId, events = []) {
	const tipIds = computeDagTipIdsFromEvents(events)
	return {
		anchorEventId,
		membersRoot: state.membersRoot ?? null,
		channelPermissionsHash: createHash('sha256')
			.update(canonicalStringify(state.channelPermissions || {}))
			.digest('hex'),
		tipsHash: computeLocalTipsHash(tipIds),
		materializedAt: Date.now(),
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {string} anchorEventId checkpoint tip
 * @param {object[]} [eventsHint] 已加载事件，避免重复读盘
 * @returns {Promise<object | null>} 新签名事件或 null
 */
export async function maybeAppendStateSummary(username, groupId, state, anchorEventId, eventsHint = null) {
	const events = eventsHint ?? await readJsonl(eventsPath(username, groupId))
	const last = findLastEventOfType(events, 'state_summary')
	const minInterval = 50_000
	if (last && events.length - last.index < minInterval) return null
	const content = buildStateSummaryContent(state, anchorEventId, events)
	return appendSignedLocalEvent(username, groupId, {
		type: 'state_summary',
		timestamp: Date.now(),
		content,
	})
}
