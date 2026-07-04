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
const m1 = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-M1' },
})).json.event?.id
const c1 = (await Api(FedA, 'POST', `/groups/${gid}/channels`, { name: 'live-chan', type: 'text' })).json.channelId
await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: m1, emoji: THUMBS_UP })
const m2 = (await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-M2' },
})).json.event?.id

const r1 = await PollUntil(40, 3, async () => {
	const msgs = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (msgs.json.messages?.filter(row => row.eventId === m1).length ?? 0) >= 1
})
console.log(`B sees A-msg M1 (live push): ${Boolean(r1)}`)

const r2 = await PollUntil(40, 3, async () => {
	const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
	return s.json.meta?.channels?.[c1] != null
})
console.log(`B sees A-channel C1 (live push): ${Boolean(r2)}`)

const r3 = await PollUntil(40, 3, () => TestFedHasReaction(FedB, gid, cid, m1))
console.log(`B sees A-reaction (live push): ${Boolean(r3)}`)

const r4 = await PollUntil(40, 3, async () => {
	const msgs = await Api(FedA, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (msgs.json.messages?.filter(row => row.eventId === m2).length ?? 0) >= 1
})
console.log(`A sees B-msg M2 (live push): ${Boolean(r4)}`)

console.log('\n--- peers snapshot ---')
const pa = (await Api(FedA, 'GET', `/groups/${gid}/peers`)).json
const pb = (await Api(FedB, 'GET', `/groups/${gid}/peers`)).json
console.log(`A: fed=${pa.federationEnabled} peers=${pa.peers?.length ?? 0} trusted=${pa.trustedPeers?.length ?? 0}`)
console.log(`B: fed=${pb.federationEnabled} peers=${pb.peers?.length ?? 0} trusted=${pb.trustedPeers?.length ?? 0}`)

await ClearFedGroup(gid)
console.log(`\ngroup=${gid} M1=${Boolean(r1)} C1=${Boolean(r2)} React=${Boolean(r3)} M2=${Boolean(r4)}`)
