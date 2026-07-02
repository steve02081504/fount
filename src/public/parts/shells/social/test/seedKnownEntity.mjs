import { parseEntityHash } from 'fount/scripts/p2p/entity_id.mjs'
import { applyNetworkHint } from 'fount/scripts/p2p/network.mjs'
import { getEntityStore, isNodeInitialized } from 'fount/scripts/p2p/node/instance.mjs'

/** 前端 / live 烟测共用的「可发现」占位 entityHash（nodeHash 经 network hint 注册）。 */
export const SEEDED_TEST_TARGET_HASH = 'a'.repeat(128)

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
