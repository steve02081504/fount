/**
 * 跨节点 bootstrap 入群：侧栏群列表须识别本地 member_join（不能只读 owner 签名 checkpoint）。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createChatFederationSim } from '../simulation/federation.mjs'

Deno.test('enumerateJoinedFederatedGroups after snapshot bootstrap + local member_join', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'List Bootstrap',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: 'default',
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	const joinerKey = await joinGroup(NODE_B, NODE_A, groupId, 'invite-list')
	const { state } = await modules.materialize.getState(NODE_B, groupId)
	assertEquals(state.members[joinerKey]?.status, 'active', 'getState sees joiner')

	const { enumerateJoinedFederatedGroups } = await import('../../src/group/queries.mjs')
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const operatorB = await resolveOperatorEntityHashForUser(NODE_B)
	const rows = await enumerateJoinedFederatedGroups(NODE_B, operatorB)
	const row = rows.find(entry => entry.groupId === groupId)
	assert(row, 'joined group appears in sidebar list API')
	assertEquals(row.name, 'List Bootstrap')
})
