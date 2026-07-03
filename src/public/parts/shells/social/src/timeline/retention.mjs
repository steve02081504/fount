import { runTimelineMaintenance } from '../../../../../../scripts/p2p/timeline/retention_runner.mjs'
import { timelineEventsPath } from '../paths.mjs'

import { canonicalizeSignedTimelineEvent } from './canonicalizeEvent.mjs'

/** @type {Set<string>} */
export const SOCIAL_TIMELINE_ANCHOR_TYPES = new Set([
	'social_meta',
	'state_summary',
	'follow',
	'unfollow',
])

const DEFAULT_RETENTION_DEPTH = 200_000
const DEFAULT_RETENTION_MS = 365 * 24 * 3600 * 1000
const DEFAULT_COMPACT_TRIGGER = 100_000

/**
 * @param {object} socialMeta 时间线 meta
 * @returns {{ maxDepth: number, maxMs: number, compactTrigger: number }} 保留策略
 */
export function socialRetentionPolicy(socialMeta = {}) {
	return {
		maxDepth: Math.max(256, Number(socialMeta.eventRetentionDepth ?? socialMeta.event_retention_depth) || DEFAULT_RETENTION_DEPTH),
		maxMs: Math.max(3_600_000, Number(socialMeta.eventRetentionMs ?? socialMeta.event_retention_ms) || DEFAULT_RETENTION_MS),
		compactTrigger: Math.max(256, Number(socialMeta.compactTriggerEventDepth) || DEFAULT_COMPACT_TRIGGER),
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash owner
 * @param {object | null} checkpoint 快照
 * @param {object} socialMeta 物化 meta
 * @returns {Promise<void>} 无返回值
 */
export async function runSocialTimelineMaintenance(username, entityHash, checkpoint, socialMeta) {
	const path = timelineEventsPath(username, entityHash)
	const policy = socialRetentionPolicy(socialMeta)
	await runTimelineMaintenance({
		eventsFilePath: path,
		checkpoint,
		policy: {
			maxDepth: policy.maxDepth,
			maxMs: policy.maxMs,
			anchorTypes: SOCIAL_TIMELINE_ANCHOR_TYPES,
		},
		sanitize: canonicalizeSignedTimelineEvent,
		compactTrigger: policy.compactTrigger,
	})
}
