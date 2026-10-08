/** 远端 member_join 到达创建者后产生显式 admin 事件，并在重放时去重。 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createChatFederationSim } from '../simulation/federation.mjs'

Deno.test('accepted federated ECDH joins grant both users admin and permit joiner metadata writes', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup, federate, stateOf, readEvents } = sim
	const owner = nodeName('A')
	const peer = nodeName('B')
	const signer = await modules.localSigner.getLocalSignerForNewGroup(owner, groupId)
	await modules.lifecycle.createGroup(owner, {
		groupId, ownerPubKeyHash: signer.sender, secretKey: signer.secretKey,
		joinPolicy: 'open', enableGroupFederation: false,
	})
	await modules.append.appendSignedLocalEvent(owner, groupId, {
		type: 'group_meta_update', timestamp: Date.now(), content: { dmKind: 'ecdh' },
	}, { publishFederation: false })
	const peerKey = await joinGroup(peer, owner, groupId, 'dm-test')
	assertEquals((await readEvents(peer, groupId)).filter(event => event.type === 'role_assign').length, 0,
		'an unprivileged joining replica must not append governance events')
	await federate(peer, [owner], groupId)
	for (const key of [peerKey, signer.sender])
		assert((await stateOf(owner, groupId)).members[key].roles.includes('admin'), `${key} holds admin on creator`)
	await federate(owner, [peer], groupId)
	assert((await stateOf(peer, groupId)).members[peerKey].roles.includes('admin'))
	await modules.append.appendSignedLocalEvent(peer, groupId, {
		type: 'group_meta_update', timestamp: Date.now(), content: { name: 'renamed by peer' },
	}, { publishFederation: false })
	await federate(peer, [owner], groupId)
	const { maybeAssignEcdhDmAdmin } = await import('../../src/chat/dm/index.mjs')
	const count = (await readEvents(owner, groupId)).filter(event => event.type === 'role_assign').length
	await Promise.all([maybeAssignEcdhDmAdmin(owner, groupId), maybeAssignEcdhDmAdmin(owner, groupId)])
	assertEquals((await readEvents(owner, groupId)).filter(event => event.type === 'role_assign').length, count)
	assertEquals((await stateOf(owner, groupId)).groupMeta.name, 'renamed by peer')
})
