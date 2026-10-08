/** 缓存 runtime 即时包含远端和本地明文消息。 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createChatFederationSim } from '../simulation/federation.mjs'

Deno.test('warm runtime sees remote and local encrypted messages without rebuilding', async () => {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup, federate, postMessage } = sim
	const owner = nodeName('A')
	const peer = nodeName('B')
	const signer = await modules.localSigner.getLocalSignerForNewGroup(owner, groupId)
	await modules.lifecycle.createGroup(owner, {
		groupId, ownerPubKeyHash: signer.sender, secretKey: signer.secretKey,
		joinPolicy: 'open', defaultChannelId: 'default', enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(owner, groupId, { checkpointOwnerSecretKey: signer.secretKey })
	await joinGroup(peer, owner, groupId, 'runtime-test')
	await federate(peer, [owner], groupId)
	await modules.schedule.rotateAllChannelKeys(owner, groupId)
	await federate(owner, [peer], groupId)
	const { getGroupRuntime, rebuildGroupRuntime } = await import('../../src/chat/session/runtime.mjs')
	const runtime = await getGroupRuntime(groupId, owner)
	const remote = await postMessage(peer, groupId, 'default', 'remote plaintext', [owner])
	const local = await postMessage(owner, groupId, 'default', 'local plaintext', [peer])
	assertEquals(remote.content.scheme, 'channel-key')
	assertEquals(local.content.scheme, 'channel-key')
	assertEquals(runtime.chatLog.map(entry => entry.extension.chat.eventId), [remote.id, local.id])
	assertEquals(runtime.chatLog.map(entry => entry.content), ['remote plaintext', 'local plaintext'])
	const { actions } = await import('../../src/actions.mjs')
	assertEquals((await actions.tail({ groupId, n: 10 })).map(entry => entry.content), ['remote plaintext', 'local plaintext'])
	assertEquals((await rebuildGroupRuntime(groupId, owner)).chatLog.map(entry => entry.content), ['remote plaintext', 'local plaintext'])
})
