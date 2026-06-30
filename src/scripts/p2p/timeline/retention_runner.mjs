import { readJsonl } from '../dag/storage.mjs'

import { pruneEventsJsonlAfterCheckpoint } from './prune.mjs'
import { enforceTimelineEventRetention } from './retention.mjs'

/**
 * @param {{
 *   eventsFilePath: string,
 *   readCheckpoint: () => Promise<object | null>,
 *   policy: { maxDepth: number, maxMs: number, anchorTypes: Set<string> },
 *   sanitize?: (row: object) => object,
 * }} args 保留参数
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 裁剪统计
 */
export async function enforceDagRetention({ eventsFilePath, readCheckpoint, policy, sanitize = row => row }) {
	const checkpoint = await readCheckpoint()
	return enforceTimelineEventRetention(eventsFilePath, checkpoint, policy, sanitize)
}

/**
 * @param {{
 *   eventsFilePath: string,
 *   checkpoint: object | null,
 *   policy: { maxDepth: number, maxMs: number, anchorTypes: Set<string> },
 *   sanitize: (row: object) => object,
 *   compactTrigger: number,
 * }} args 维护参数
 * @returns {Promise<void>}
 */
export async function runTimelineMaintenance({ eventsFilePath, checkpoint, policy, sanitize, compactTrigger }) {
	await enforceTimelineEventRetention(eventsFilePath, checkpoint, policy, sanitize)
	const count = (await readJsonl(eventsFilePath, { sanitize })).length
	if (count > compactTrigger && checkpoint?.checkpoint_event_id)
		await pruneEventsJsonlAfterCheckpoint(eventsFilePath, checkpoint, sanitize)
}
