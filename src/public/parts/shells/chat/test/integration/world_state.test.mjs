/**
 * world_state 状态通道 + WorldChatHost 集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { allowNoise } from 'fount/scripts/test/core/allowNoise.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createChatFederationSim } from '../simulation/federation.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const REPLICATED_WORLD = 'replicated_world'
const HOOK_KEY = '__fount_replicated_world_hook_state__'

/**
 * @param {string} dataRoot 数据根
 * @param {string} username 用户
 * @param {string} worldname fixture 目录名
 * @returns {Promise<void>}
 */
async function seedWorldFixture(dataRoot, username, worldname) {
	const from = join(fixturesRoot, 'worlds', worldname)
	const to = join(dataRoot, 'users', username, 'worlds', worldname)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

Deno.test('world_state: 双 replica 状态收敛 + 越权折叠忽略 + 联邦 64KB 拒收', async t => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, dataRoot, federate, gossipAll, joinGroup, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const channelId = 'default'

	await seedWorldFixture(dataRoot, NODE_A, REPLICATED_WORLD)
	await seedWorldFixture(dataRoot, NODE_B, REPLICATED_WORLD)

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'world-state',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: channelId,
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	await joinGroup(NODE_B, NODE_A, groupId, 'invite-wo')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	const { appendSessionWorldBind } = await import('../../src/chat/session/dagSession.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')
	const { createWorldChatHost, resetWorldHostConnectedCacheForTests } = await import('../../src/chat/session/worldHost.mjs')
	const { WORLD_STATE_CONTENT_MAX_BYTES } = await import('../../src/chat/dag/remoteIngest.mjs')
	const { foldAuthorizedValue } = await import(pathToFileURL(join(dataRoot, 'users', NODE_A, 'worlds', REPLICATED_WORLD, 'main.mjs')).href)

	await appendSessionWorldBind(NODE_A, groupId, REPLICATED_WORLD)
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	await t.step('ChatHostConnected 接线且 A set → B get 收敛', async () => {
		resetWorldHostConnectedCacheForTests()
		globalThis[HOOK_KEY] = { hostConnected: 0, host: null, lastFoldIgnored: 0 }

		await resolveWorld(groupId, channelId, NODE_A)
		assertEquals(globalThis[HOOK_KEY].hostConnected, 1)
		assert(globalThis[HOOK_KEY].host)

		const hostA = createWorldChatHost(NODE_A, groupId, REPLICATED_WORLD)
		await hostA.state.set('weather', 'rain')
		await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

		const hostB = createWorldChatHost(NODE_B, groupId, REPLICATED_WORLD)
		assertEquals(await hostB.state.get('weather'), 'rain')

		const stateB = await stateOf(NODE_B, groupId)
		assertEquals(stateB.worldStates[REPLICATED_WORLD].weather.value, 'rain')
	})

	await t.step('越权写入落 DAG 但折叠层忽略', async () => {
		globalThis[HOOK_KEY] = { hostConnected: 0, host: null, lastFoldIgnored: 0 }
		const protectedKey = `protected/${ownerSigner.sender}/gold`
		const hostA = createWorldChatHost(NODE_A, groupId, REPLICATED_WORLD)
		await hostA.state.set(protectedKey, 100)
		await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

		const { sender, secretKey } = await modules.localSigner.getLocalSignerForNewGroup(NODE_B, groupId)
		await modules.append.appendEvent(NODE_B, groupId, {
			type: 'world_state',
			sender,
			timestamp: Date.now(),
			content: {
				worldname: REPLICATED_WORLD,
				action: 'set',
				key: protectedKey,
				value: 9999,
			},
		}, secretKey, { publishFederation: false })
		await federate(NODE_B, [NODE_A], groupId)

		const hostA2 = createWorldChatHost(NODE_A, groupId, REPLICATED_WORLD)
		assertEquals(await foldAuthorizedValue(hostA2, protectedKey), 100)
		assert(globalThis[HOOK_KEY].lastFoldIgnored >= 1)
		// 分层语义锁定：shell LWW reducer 世界无关、不裁权限——state.get 返回越权后值；
		// "忽略越权写入" 是 world 折叠层（state.log 自定义 fold）的职责，见上一断言。
		assertEquals(await hostA2.state.get(protectedKey), 9999)
	})

	await t.step('联邦入站超 64KB 拒收，本机写不受限', async () => {
		const bigValue = 'x'.repeat(WORLD_STATE_CONTENT_MAX_BYTES)
		const hostA = createWorldChatHost(NODE_A, groupId, REPLICATED_WORLD)
		await hostA.state.set('big_local', bigValue)

		const eventsA = await modules.storage.readJsonl(modules.paths.eventsPath(NODE_A, groupId), {
			sanitize: modules.strip.stripDagEventLocalExtensions,
		})
		const bigEvent = [...eventsA].reverse().find(event =>
			event.type === 'world_state' && event.content?.key === 'big_local')
		assert(bigEvent)

		const ingest = await allowNoise(
			'federation: drop remote event \\(content too large\\)',
			() => modules.remoteIngest.appendValidatedRemoteEvent(NODE_B, groupId, bigEvent),
			{ drainMs: 0 },
		)
		assertEquals(ingest.status, 'invalid')
		assertEquals(ingest.reason, 'content_too_large')

		assertEquals(await hostA.state.get('big_local'), bigValue)
	})
})
