import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	PollUntil,
	TestFedHasChannel,
	TestFedHasMessage,
	TestFedHasReaction,
	TestFedMessageContent,
	TestFedMessageDeleted,
	testCase,
	WaitFedConverged,
	WaitFedLive,
	WaitFedMembers,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

const THUMBS_UP = '\u{1F44D}'

console.log('=== Setup: A creates group, B joins ===')
const g = (await Api(FedA, 'POST', '/groups/', { name: 'FedExtended', description: 'extended e2e' })).json
const gid = g.groupId
const cid = g.defaultChannelId
await Api(FedA, 'PUT', `/groups/${gid}/settings`, { joinPolicy: 'open' })
const inv = (await Api(FedA, 'POST', `/groups/${gid}/invite-ticket`, { ttlMs: 3_600_000 })).json
const seedMsg = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'seed-A' },
})).json.event?.id
const jr = await Api(FedB, 'POST', `/groups/${gid}/join`, {
	roomSecret: inv.roomSecret,
	signalingAppId: inv.signalingAppId,
	introducerPubKeyHash: inv.introducerPubKeyHash,
	introducerNodeHash: inv.introducerNodeHash,
})
console.log(`join -> ${jr.status}`)
if (jr.status !== 200) throw new Error(`B join failed: ${jr.status} ${jr.raw}`)
const caught = await WaitFedMembers(FedB, gid, 2, 90)
console.log(`B caught up membership: ${caught}`)
if (!caught) throw new Error('B never reached members>=2 after join')

console.log('\n=== 1. Catchup of seed message A->B ===')
await testCase('B sees seed message', async () =>
	WaitFedConverged(FedB, gid, () => TestFedHasMessage(FedB, gid, cid, seedMsg), 60, 3, 6000),
)

console.log('\n=== 2. New channel propagation A->B ===')
const newChan = (await Api(FedA, 'POST', `/groups/${gid}/channels`, { name: 'fed-chan', type: 'text' })).json.channelId
await testCase('B sees new channel', async () =>
	WaitFedConverged(FedB, gid, () => TestFedHasChannel(FedB, gid, newChan), 60, 3, 6000),
)

console.log('\n=== 3. Live message B->A ===')
const bMsg = (await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'from-B' },
})).json.event?.id
await testCase('A sees B message (live)', async () =>
	WaitFedLive(() => TestFedHasMessage(FedA, gid, cid, bMsg), 60, 3),
)

console.log('\n=== 4. Reaction propagation A->B ===')
const seenOnA = await WaitFedLive(() => TestFedHasMessage(FedA, gid, cid, bMsg), 60, 3)
if (!seenOnA) throw new Error('A must see B message before reaction (live push prerequisite)')
const reactResp = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: bMsg, emoji: THUMBS_UP })
await testCase('A POST reaction succeeds', async () => reactResp.status === 200)
await testCase('B sees reaction on B-message', async () =>
	WaitFedLive(() => TestFedHasReaction(FedB, gid, cid, bMsg), 60, 3),
)

console.log('\n=== 5. Edit propagation A->B ===')
const aMsg = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'orig-A' },
})).json.event?.id
await Api(FedA, 'PUT', `/groups/${gid}/channels/${cid}/messages/${aMsg}`, {
	content: { type: 'text', content: 'edited-A' },
})
await testCase('B sees edited content', async () =>
	WaitFedLive(() => TestFedMessageContent(FedB, gid, cid, aMsg, 'edited-A'), 60, 3),
)

console.log('\n=== 6. Delete propagation A->B ===')
await Api(FedA, 'DELETE', `/groups/${gid}/channels/${cid}/messages/${aMsg}`)
await testCase('B sees message deleted/redacted', async () =>
	WaitFedLive(() => TestFedMessageDeleted(FedB, gid, cid, aMsg), 60, 3),
)

console.log('\n=== 7. Cross-node file transfer A->B ===')
const fileId = randomUUID()
await testCase('A uploads + registers file', async () => {
	const data = Buffer.from('fed-file-payload-1234567890').toString('base64')
	const up = await Api(FedA, 'POST', `/groups/${gid}/chunks`, { fileId, data, channelId: cid, ceMode: 'convergent' })
	if (up.status !== 200 && up.status !== 201) throw new Error(`chunk ${up.status}: ${up.raw}`)
	const ci = up.json
	const body = {
		fileId,
		name: 'fed.txt',
		size: 27,
		mimeType: 'text/plain',
		folderId: null,
		ceMode: ci.ceMode,
		contentHash: ci.contentHash,
		ciphertextHash: ci.ciphertextHash,
		wrappedKey: ci.wrappedKey,
		storageLocator: ci.storageLocator,
		key_generation: ci.key_generation,
		channelId: cid,
	}
	const reg = await Api(FedA, 'POST', `/groups/${gid}/files`, body)
	return reg.status === 201
})

await testCase('B sees file meta (DAG sync)', async () =>
	WaitFedConverged(FedB, gid, async () => {
		const m = await Api(FedB, 'GET', `/groups/${gid}/files/${fileId}/meta`)
		return m.status === 200 && m.json.fileId === fileId
	}, 60, 3, 6000),
)

await testCase('B downloads file content via federation', async () => {
	const rs = await Api(FedB, 'POST', `/groups/${gid}/files/${fileId}/download-resume`, {})
	if (rs.status !== 200) throw new Error(`resume ${rs.status}: ${rs.raw}`)
	const done = await PollUntil(150, 4, async () => {
		const st = await Api(FedB, 'GET', `/groups/${gid}/files/${fileId}/download-status`)
		if (st.status !== 200) return false
		const s = st.json.status
		if (s?.status === 'failed' || s?.error) throw new Error(`download failed: ${st.raw}`)
		return s?.status === 'done' || s?.percent === 100 || (s?.done >= s?.total && s?.total > 0)
	})
	return Boolean(done)
})

await ClearFedGroup(gid)
WriteFedSummary('FED-E2E-EXTENDED', gid)
completeLiveScript()
