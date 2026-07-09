/**
 * M7：world distribution 声明与 resolveWorld 三分支分发。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { BUILTIN_WORLD } from '../../src/chat/session/builtinParts.mjs'
import { createChatFederationSim } from '../simulation/federation.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const LOCAL_WORLD = 'local_world'
const HOSTED_WORLD = 'viewer_filter'
const HOOK_KEY = '__fount_local_world_hook_state__'

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

/**
 * @param {object} world resolveWorld 返回值
 * @returns {Promise<boolean>} GetPrompt 是否含 local marker
 */
async function promptHasLocalMarker(world) {
	const prompt = await world.interfaces.chat.GetPrompt({})
	const text = prompt?.text?.[0]?.content
	return String(text || '').includes('local-world-prompt-marker')
}

Deno.test('M7 world distribution: local 本机执行 + 未装回退 BUILTIN + hosted 回归', async t => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, dataRoot, federate, gossipAll, joinGroup, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const channelId = 'default'

	await seedWorldFixture(dataRoot, NODE_A, LOCAL_WORLD)
	await seedWorldFixture(dataRoot, NODE_A, HOSTED_WORLD)

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'world-distribution',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: channelId,
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	await joinGroup(NODE_B, NODE_A, groupId, 'invite-wd')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	const { appendSessionWorldBind } = await import('../../src/chat/session/dagSession.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')

	await t.step('local world bind 写入 distribution: local', async () => {
		globalThis[HOOK_KEY] = { promptCalls: 0, viewerCalls: 0 }
		await appendSessionWorldBind(NODE_A, groupId, LOCAL_WORLD)
		await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

		for (const node of [NODE_A, NODE_B]) {
			const session = (await stateOf(node, groupId)).session
			assertEquals(session.world.distribution, 'local')
			assertEquals(session.world.worldname, LOCAL_WORLD)
		}
	})

	await t.step('local：安装节点本机执行，未安装节点回退 BUILTIN_WORLD', async () => {
		globalThis[HOOK_KEY] = { promptCalls: 0, viewerCalls: 0 }

		const worldA = await resolveWorld(groupId, channelId, NODE_A)
		assert(await promptHasLocalMarker(worldA), 'NODE_A 应加载 local_world fixture')
		assertEquals(globalThis[HOOK_KEY].promptCalls, 1)

		globalThis[HOOK_KEY] = { promptCalls: 0, viewerCalls: 0 }
		const worldB = await resolveWorld(groupId, channelId, NODE_B)
		assertEquals(worldB, BUILTIN_WORLD)
		assertEquals(await promptHasLocalMarker(worldB), false)
		assertEquals(globalThis[HOOK_KEY].promptCalls, 0)
	})

	await t.step('hosted 回归：未声明 distribution 的 world 折叠为 hosted', async () => {
		await appendSessionWorldBind(NODE_A, groupId, HOSTED_WORLD)
		await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

		const session = (await stateOf(NODE_A, groupId)).session
		assertEquals(session.world.distribution, 'hosted')
		assertEquals(session.world.worldname, HOSTED_WORLD)

		const worldA = await resolveWorld(groupId, channelId, NODE_A)
		assert(typeof worldA.interfaces.chat.GetChatLogForViewer === 'function')
		const filtered = await worldA.interfaces.chat.GetChatLogForViewer({
			chat_log: [
				{ content: 'visible' },
				{ content: 'hidden-marker secret' },
			],
		}, { kind: 'char', charname: 'viewer_agent', memberId: 'x', ownerUsername: NODE_A, channelId })
		assertEquals(filtered.length, 1)
		assertEquals(filtered[0].content, 'visible')
	})
})
