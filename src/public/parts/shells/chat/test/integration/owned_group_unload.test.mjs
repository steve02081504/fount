/**
 * 自建群（founder）识别：用于 WS 空闲卸载时避免删盘。
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createChatFederationSim } from '../simulation/federation.mjs'

/* global Deno */
Deno.test('isLocallyOwnedGroup: founder owner vs joined member', async () => {
	const sim = await createChatFederationSim()
	const { isLocallyOwnedGroup } = await import('../../src/chat/session/persistence.mjs')
	const { modules, groupId, nodeName, joinGroup } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'Owned Group',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: 'default',
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})

	assertEquals(await isLocallyOwnedGroup(NODE_A, groupId), true)

	await joinGroup(NODE_B, NODE_A, groupId, 'invite-owned')
	await sim.federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, {
		checkpointOwnerSecretKey: ownerSigner.secretKey,
	})

	assertEquals(await isLocallyOwnedGroup(NODE_B, groupId), false)
})
