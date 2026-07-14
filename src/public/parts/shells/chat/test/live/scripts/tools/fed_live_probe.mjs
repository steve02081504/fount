import {
	Api,
	ClearFedGroup,
	FedA,
	FedB,
	PollUntil,
	TestFedHasReaction,
} from 'fount/scripts/test/live/federation/common.mjs'
import { sleep } from 'fount/scripts/test/live/http.mjs'

const THUMBS_UP = '\u{1F44D}'

const g = (await Api(FedA, 'POST', '/groups/', { name: 'LiveProbe' })).json
const gid = g.groupId
const cid = g.defaultChannelId
await Api(FedA, 'PUT', `/groups/${gid}/settings`, { joinPolicy: 'open' })
const inv = (await Api(FedA, 'POST', `/groups/${gid}/invite-ticket`, { ttlMs: 3_600_000 })).json
await Api(FedB, 'POST', `/groups/${gid}/join`, {
	roomSecret: inv.roomSecret,
	signalingAppId: inv.signalingAppId,
	introducerPubKeyHash: inv.introducerPubKeyHash,
	introducerNodeHash: inv.introducerNodeHash,
})
console.log(`group=${gid} joined; firing events in warm window (fed_core-style timing)...`)
await sleep(8000)

console.log('\n--- firing events (warm) ---')
const msgA = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-msg-a' },
})).json.event?.id
const chanExtra = (await Api(FedA, 'POST', `/groups/${gid}/channels`, { name: 'live-chan', type: 'text' })).json.channelId
await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: msgA, emoji: THUMBS_UP })
const msgB = (await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-msg-b' },
})).json.event?.id

const r1 = await PollUntil(40, 3, async () => {
	const msgs = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (msgs.json.messages?.filter(row => row.eventId === msgA).length ?? 0) >= 1
})
console.log(`B sees A-msg (live push): ${Boolean(r1)}`)

const r2 = await PollUntil(40, 3, async () => {
	const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
	return s.json.meta?.channels?.[chanExtra] != null
})
console.log(`B sees A-channel (live push): ${Boolean(r2)}`)

const r3 = await PollUntil(40, 3, () => TestFedHasReaction(FedB, gid, cid, msgA))
console.log(`B sees A-reaction (live push): ${Boolean(r3)}`)

const r4 = await PollUntil(40, 3, async () => {
	const msgs = await Api(FedA, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (msgs.json.messages?.filter(row => row.eventId === msgB).length ?? 0) >= 1
})
console.log(`A sees B-msg (live push): ${Boolean(r4)}`)

console.log('\n--- peers snapshot ---')
const pa = (await Api(FedA, 'GET', `/groups/${gid}/peers`)).json
const pb = (await Api(FedB, 'GET', `/groups/${gid}/peers`)).json
console.log(`A: fed=${pa.federationEnabled} peers=${pa.peers?.length ?? 0} trusted=${pa.trustedPeers?.length ?? 0}`)
console.log(`B: fed=${pb.federationEnabled} peers=${pb.peers?.length ?? 0} trusted=${pb.trustedPeers?.length ?? 0}`)

await ClearFedGroup(gid)
console.log(`\ngroup=${gid} msgA=${Boolean(r1)} channel=${Boolean(r2)} React=${Boolean(r3)} msgB=${Boolean(r4)}`)
