/**
 * member_leave 经 remoteIngest 在 A 侧触发完整 checkpoint 重建（B 侧 skipCheckpointRebuild 仅用于保留已签名帧供投递）。
 */
import { readFile } from 'node:fs/promises'

import { assert, assertEquals } from 'jsr:@std/assert'

import { isSignedBaseCheckpoint } from '../../src/chat/dag/checkpointPayload.mjs'
import { createChatFederationSim } from '../simulation/federation.mjs'

/* global Deno */
Deno.test('member_leave triggers checkpoint rebuild without fast-path flags', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup, federate, stateOf, activeMembers } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'Leave checkpoint',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: 'default',
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})

	const memberB = await joinGroup(NODE_B, NODE_A, groupId, 'invite-leave')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})

	const beforeLeave = activeMembers(await stateOf(NODE_A, groupId))
	assert(beforeLeave.has(memberB), 'B active before leave')

	const leaveEvent = await modules.append.appendEvent(NODE_B, groupId, {
		type: 'member_leave',
		sender: memberB,
		timestamp: Date.now(),
		content: {},
	}, (await modules.localSigner.resolveLocalEventSigner(NODE_B, groupId)).secretKey, {
		skipCheckpointRebuild: true,
		publishFederation: false,
	})

	const ingest = await modules.remoteIngest.appendValidatedRemoteEvent(NODE_A, groupId, leaveEvent, { logFailures: false })
	assertEquals(ingest.status, 'applied', 'A ingests member_leave')

	const afterLeaveA = await stateOf(NODE_A, groupId)
	const afterLeaveB = await stateOf(NODE_B, groupId)
	const { checkpoint: checkpointA } = await modules.materialize.getState(NODE_A, groupId)
	assertEquals(activeMembers(afterLeaveA).has(memberB), false, 'A no longer lists B as active')
	assertEquals(activeMembers(afterLeaveB).has(memberB), false, 'B left locally')
	assert(checkpointA?.epoch_id >= 1, 'A checkpoint rebuilt after leave')
})

Deno.test('joiner keeps signed checkpoint and can post after ingesting a message', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup, federate, postMessage, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'Joiner checkpoint',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: 'default',
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})

	const memberB = await joinGroup(NODE_B, NODE_A, groupId, 'invite-joiner')
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})
	await federate(NODE_A, [NODE_B], groupId)
	await modules.schedule.rotateAllChannelKeys(NODE_A, groupId)
	await federate(NODE_A, [NODE_B], groupId)

	const defaultChannelId = (await stateOf(NODE_A, groupId)).groupSettings.defaultChannelId
	await postMessage(NODE_A, groupId, defaultChannelId, 'hello from A', [NODE_B])
	await postMessage(NODE_A, groupId, defaultChannelId, 'hello again from A', [NODE_B])

	const snapB = JSON.parse(await readFile(modules.paths.snapshotPath(NODE_B, groupId), 'utf8'))
	assert(isSignedBaseCheckpoint(snapB), 'joiner must keep owner-signed checkpoint after ingesting messages')
	assertEquals((await stateOf(NODE_B, groupId)).members[memberB]?.status, 'active')
	await postMessage(NODE_B, groupId, defaultChannelId, 'hello from B', [NODE_A])
})
