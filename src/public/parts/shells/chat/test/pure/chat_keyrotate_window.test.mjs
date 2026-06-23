/**
 * 任务 B 实证：`channel_key_rotate(_batch)` 被 owner 折叠进签名 checkpoint 后的窗口期交互。
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createChatFederationSim } from '../simulation/federation.mjs'

/* global Deno */
Deno.test('channel_key_rotate fold window does not block message interaction', async t => {
	const sim = await createChatFederationSim({ withGovernance: true })
	const {
		modules, groupId, nodeName, gossipAll, joinGroup, postMessage, adoptSnapshot, tipsOf,
	} = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const NODE_C = nodeName('C')
	/** 各节点 sender 公钥哈希表。
	 * @type {Record<string, string>} */
	const hash = {}
	let channelId = ''

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	hash.A = ownerSigner.sender

	await modules.lifecycle.createGroup(NODE_A, {
		groupId, name: 'KRW', ownerPubKeyHash: hash.A,
		secretKey: ownerSigner.secretKey, defaultChannelId: 'default', enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	channelId = (await modules.materialize.getState(NODE_A, groupId)).state.groupSettings.defaultChannelId

	hash.B = await joinGroup(NODE_B, NODE_A, groupId, 'invite-krw')
	await sim.federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	hash.C = await joinGroup(NODE_C, NODE_A, groupId, 'invite-krw')
	await sim.federate(NODE_C, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B, NODE_C], groupId)

	await t.step('准备：授予 B founder，全员持有初始 K_ch', async () => {
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign', timestamp: Date.now(),
			content: { targetMemberKey: hash.B, roleId: 'founder' },
		}, { publishFederation: false })
		await modules.schedule.rotateAllChannelKeys(NODE_A, groupId)
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)
	})

	let mergedTipA = ''
	await t.step('并发 governance 分叉 + owner 折叠；成员未 adopt → tip 分叉', async () => {
		await modules.schedule.appendChannelKeyRotate(NODE_A, groupId, channelId)
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_create', timestamp: Date.now(),
			content: { roleId: 'fork_a', name: 'ForkA', color: '#111111', position: 5, permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false },
		}, { publishFederation: false })
		await modules.append.appendSignedLocalEvent(NODE_B, groupId, {
			type: 'role_create', timestamp: Date.now(),
			content: { roleId: 'fork_b', name: 'ForkB', color: '#222222', position: 6, permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false },
		}, { publishFederation: false })
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)
		for (const node of [NODE_A, NODE_B, NODE_C])
			assert((await tipsOf(node, groupId)).length >= 2, `${node} sees the concurrent governance fork (>=2 tips)`)

		await modules.lifecycle.convergeDagTipsIfAuthorized(NODE_A, groupId)
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

		const tipsA = await tipsOf(NODE_A, groupId)
		const tipsB = await tipsOf(NODE_B, groupId)
		const tipsC = await tipsOf(NODE_C, groupId)
		assertEquals(tipsA.length, 1, 'owner converged to a single merged tip')
		assert(JSON.stringify(tipsA) !== JSON.stringify(tipsB), `A(merged) vs B(un-adopted) tips diverge (A=${tipsA} B=${tipsB})`)
		assertEquals(tipsB, tipsC, 'B and C share the same un-adopted forked tips')
		mergedTipA = tipsA[0]
		const bIds = new Set((await sim.readEvents(NODE_B, groupId)).map(e => String(e.id).toLowerCase()))
		assert(!bIds.has(mergedTipA), 'B has not adopted owner merge before window')
	})

	/** 窗口期内互发消息的 event id 列表。
	 * @type {string[]} */
	const windowMsgIds = []
	await t.step('窗口期：A/B/C 互发消息均可解密', async () => {
		const mA = await postMessage(NODE_A, groupId, channelId, 'owner msg in window', [NODE_B, NODE_C])
		const mB = await postMessage(NODE_B, groupId, channelId, 'member-B msg in window', [NODE_A, NODE_C])
		const mC = await postMessage(NODE_C, groupId, channelId, 'member-C msg in window', [NODE_A, NODE_B])
		windowMsgIds.push(mA.id, mB.id, mC.id)

		for (const [author, m] of [['A', mA], ['B', mB], ['C', mC]])
			for (const node of [NODE_A, NODE_B, NODE_C]) {
				const row = await sim.channelMessage(node, groupId, channelId, m.id)
				assert(row, `${node} received window message from ${author}`)
				assert(!row.content?.decryptFailed, `${node} decrypted window message from ${author}`)
				assert(String(row.content?.content || '').includes('in window'),
					`${node} sees plaintext of ${author}'s window message`)
			}

		const bIds = new Set((await sim.readEvents(NODE_B, groupId)).map(e => String(e.id).toLowerCase()))
		assert(!bIds.has(mergedTipA), 'B never adopted owner merge event across the messaging window')
	})

	await t.step('adopt 后 tip 收敛，历史消息仍可见', async () => {
		await adoptSnapshot(NODE_A, NODE_B, groupId)
		await adoptSnapshot(NODE_A, NODE_C, groupId)
		const tipsA = await tipsOf(NODE_A, groupId)
		assertEquals(await tipsOf(NODE_B, groupId), tipsA, 'B converged to owner tip after adopt')
		assertEquals(await tipsOf(NODE_C, groupId), tipsA, 'C converged to owner tip after adopt')

		for (const id of windowMsgIds)
			for (const node of [NODE_B, NODE_C]) {
				const row = await sim.channelMessage(node, groupId, channelId, id)
				assert(row && !row.content?.decryptFailed, `${node} still sees window message ${id} after adopt`)
			}
	})
})
