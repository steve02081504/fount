import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getEntityStore, isNodeInitialized } from 'npm:@steve02081504/fount-p2p/node/instance'
import { applyNetworkHint } from 'npm:@steve02081504/fount-p2p/node/network'

import { SEEDED_TEST_TARGET_HASH } from './frontend/seedConstants.mjs'

/** 前端 / live 烟测共用的可发现占位 entityHash（经 network hint 注册）。 */
export { SEEDED_TEST_TARGET_HASH }

/**
 * 将 SEEDED_TEST_TARGET_HASH 注册为可解析目标（network hint + 最小 profile）。
 * @returns {Promise<void>}
 */
export async function seedKnownTestEntityTarget() {
	if (!isNodeInitialized()) return
	const parsed = parseEntityHash(SEEDED_TEST_TARGET_HASH)
	if (!parsed) return
	applyNetworkHint({
		nodeHash: parsed.nodeHash,
		source: 'test:fixture',
		kind: 'discover',
		weight: 0.2,
	})
	const store = getEntityStore()
	const existing = await store.readEntityJson(SEEDED_TEST_TARGET_HASH, 'profile.json')
	if (existing) return
	await store.writeEntityJson(SEEDED_TEST_TARGET_HASH, 'profile.json', {
		entityHash: SEEDED_TEST_TARGET_HASH,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
		localized: {},
		status: 'offline',
		customStatus: '',
		lastSeenAt: 0,
		stats: { joinedAt: Date.now(), messageCount: 0, groupCount: 0, channelCount: 0 },
	})
}
