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

const REPLICATED_WORLD = 'replicated_world'
const REPLICATED_HOOK_KEY = '__fount_replicated_world_hook_state__'

Deno.test('M7 replicated: 本机执行 + 未装节点走 remoteWorldProxy', async t => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, dataRoot, federate, gossipAll, joinGroup, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const channelId = 'default'

	await seedWorldFixture(dataRoot, NODE_A, REPLICATED_WORLD)

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'world-replicated',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: channelId,
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await joinGroup(NODE_B, NODE_A, groupId, 'invite-repl')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	const { appendSessionWorldBind } = await import('../../src/chat/session/dagSession.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')
	const { REMOTE_WORLD_PROXY_SYMBOL } = await import('../../src/chat/federation/remoteWorldProxy.mjs')

	await appendSessionWorldBind(NODE_A, groupId, REPLICATED_WORLD)
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	await t.step('replicated bind 写入 distribution', async () => {
		const session = (await stateOf(NODE_A, groupId)).session
		assertEquals(session.world.distribution, 'replicated')
		assertEquals(session.world.worldname, REPLICATED_WORLD)
	})

	await t.step('本机已装 replicated world 本机执行', async () => {
		globalThis[REPLICATED_HOOK_KEY] = { hostConnected: 0, promptCalls: 0, host: null, lastFoldIgnored: 0 }
		const worldA = await resolveWorld(groupId, channelId, NODE_A)
		const prompt = await worldA.interfaces.chat.GetPrompt({})
		assert(String(prompt?.text?.[0]?.content || '').includes('replicated-world-prompt-marker'))
		assertEquals(globalThis[REPLICATED_HOOK_KEY].promptCalls, 1)
		assertEquals(globalThis[REPLICATED_HOOK_KEY].hostConnected, 1)
		assert(!worldA[REMOTE_WORLD_PROXY_SYMBOL])
	})

	await t.step('未装 replicated world 的节点走 remoteWorldProxy', async () => {
		const worldB = await resolveWorld(groupId, channelId, NODE_B)
		assert(worldB[REMOTE_WORLD_PROXY_SYMBOL])
		assert(worldB !== BUILTIN_WORLD)
		assert(typeof worldB.interfaces.chat.GetChatLogForViewer === 'function')
	})

	await t.step('proxy → rpcDispatcher 真往返（进程内环回，代 WS 传输）', async () => {
		// 登记 owner 槽位后 invokeGroupRpc 本机优先分支命中 tryInvokeLocalWorldRpc：
		// 走真实的 memberId 解析 → bind 判定 → loadPart → JSON 边界 normalize 全链，仅略过 WS 帧本身。
		const { groupMetadatas } = await import('../../src/chat/session/wsLifecycle.mjs')
		groupMetadatas.set(groupId, { username: NODE_A, chatMetadata: null })

		globalThis[REPLICATED_HOOK_KEY] = { hostConnected: 0, promptCalls: 0, host: null, lastFoldIgnored: 0 }
		const worldB = await resolveWorld(groupId, channelId, NODE_B)
		assert(worldB[REMOTE_WORLD_PROXY_SYMBOL])

		const prompt = await worldB.interfaces.chat.GetPrompt({})
		assert(String(prompt?.text?.[0]?.content || '').includes('replicated-world-prompt-marker'))
		assertEquals(globalThis[REPLICATED_HOOK_KEY].promptCalls, 1, '应执行 NODE_A 侧的 world part')

		const chatLog = [{ content: 'rpc-roundtrip-entry', role: 'user' }]
		const viewed = await worldB.interfaces.chat.GetChatLogForViewer(
			{ chat_log: chatLog },
			{ kind: 'user', memberId: 'x', ownerUsername: NODE_B, channelId },
		)
		assertEquals(viewed.length, 1)
		assertEquals(viewed[0].content, 'rpc-roundtrip-entry')

		// 远端未实现的钩子经 METHOD_NOT_FOUND 降级为 undefined（等价本地缺钩子）
		assertEquals(await worldB.interfaces.chat.GetGreeting({}, 0), undefined)

		groupMetadatas.delete(groupId)
	})
})

Deno.test('M7 hosted: 未装 world 的 replica 不加载 hosted part（sim 同 nodeHash）', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, dataRoot, federate, gossipAll, joinGroup, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const channelId = 'default'

	await seedWorldFixture(dataRoot, NODE_A, HOSTED_WORLD)

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'world-hosted-remote',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: channelId,
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await joinGroup(NODE_B, NODE_A, groupId, 'invite-hr')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	const { appendSessionWorldBind } = await import('../../src/chat/session/dagSession.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')
	const { REMOTE_WORLD_PROXY_SYMBOL } = await import('../../src/chat/federation/remoteWorldProxy.mjs')

	await appendSessionWorldBind(NODE_A, groupId, HOSTED_WORLD)
	await gossipAll([NODE_A, NODE_B], groupId, { assertConverged: true })

	const worldA = await resolveWorld(groupId, channelId, NODE_A)
	assert(typeof worldA.interfaces.chat.GetChatLogForViewer === 'function')
	assert(String(worldA.info?.['zh-CN']?.name || '').includes('Viewer'))

	// 进程内 sim 共享 nodeHash：B 未单独 seed fixture 仍可通过 loadPart 加载 hosted world（非 proxy）。
	const worldB = await resolveWorld(groupId, channelId, NODE_B)
	assert(typeof worldB.interfaces.chat.GetChatLogForViewer === 'function')
	assert(String(worldB.info?.['zh-CN']?.name || '').includes('Viewer'))
	assert(!worldB[REMOTE_WORLD_PROXY_SYMBOL])
})
