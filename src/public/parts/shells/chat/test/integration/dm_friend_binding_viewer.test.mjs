/**
 * DM 好友绑定的查看者视角：建群者写进联邦元数据的是「我的对端」，
 * 受邀方物化同一份元数据后必须把它还原成建群者，而不是看到自己。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createChatFederationSim } from '../simulation/federation.mjs'

Deno.test('a joined DM lists the creator as its friend while the creator still lists the joiner', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup } = sim
	const CREATOR = nodeName('A')
	const JOINER = nodeName('B')

	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const creatorEntity = await resolveOperatorEntityHashForUser(CREATOR)
	const joinerEntity = await resolveOperatorEntityHashForUser(JOINER)

	const signer = await modules.localSigner.getLocalSignerForNewGroup(CREATOR, groupId)
	await modules.lifecycle.createGroup(CREATOR, {
		groupId,
		name: 'DM · friend binding',
		ownerPubKeyHash: signer.sender,
		secretKey: signer.secretKey,
		defaultChannelName: '',
		markDefaultChannel: false,
		enableGroupFederation: false,
		// 建群者视角：这个 DM 的对端是受邀方。
		friendBinding: { entityHash: joinerEntity },
	})
	await modules.append.appendSignedLocalEvent(CREATOR, groupId, {
		type: 'group_meta_update',
		timestamp: Date.now(),
		content: { dmKind: 'ecdh' },
	}, { publishFederation: false })
	await modules.materialize.rebuildAndSaveCheckpoint(CREATOR, groupId)

	await joinGroup(JOINER, CREATOR, groupId, 'invite-dm')

	const { enumerateJoinedFederatedGroups } = await import('../../src/group/queries.mjs')
	const creatorRows = await enumerateJoinedFederatedGroups(CREATOR, creatorEntity)
	const joinerRows = await enumerateJoinedFederatedGroups(JOINER, joinerEntity)

	const creatorRow = creatorRows.find(row => row.groupId === groupId)
	const joinerRow = joinerRows.find(row => row.groupId === groupId)
	assert(creatorRow, 'creator lists the DM')
	assert(joinerRow, 'joiner lists the DM')

	assertEquals(creatorRow.friendBinding?.entityHash, joinerEntity, 'creator side keeps its declared peer')
	assertEquals(joinerRow.friendBinding?.entityHash, creatorEntity,
		'the joined side must see the creator, never itself')
})
