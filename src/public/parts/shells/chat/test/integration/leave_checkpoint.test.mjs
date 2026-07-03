/**
 * member_leave 经 remoteIngest 在 A 侧触发完整 checkpoint 重建（B 侧 skipCheckpointRebuild 仅用于保留已签名帧供投递）。
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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
