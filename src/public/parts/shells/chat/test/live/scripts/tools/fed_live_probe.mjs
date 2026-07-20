import {
	Api,
	ClearFedGroup,
	FedA,
	FedB,
	pollUntil,
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
const eventIdA = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-message-a' },
})).json.event?.id
const chanExtra = (await Api(FedA, 'POST', `/groups/${gid}/channels`, { name: 'live-chan', type: 'text' })).json.channelId
await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: eventIdA, emoji: THUMBS_UP })
const eventIdB = (await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'live-message-b' },
})).json.event?.id

const r1 = await pollUntil(async () => {
	const listResponse = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (listResponse.json.messages?.filter(row => row.eventId === eventIdA).length ?? 0) >= 1
}, 40, 3)
console.log(`B sees A-message (live push): ${Boolean(r1)}`)

const r2 = await pollUntil(async () => {
	const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
	return s.json.meta?.channels?.[chanExtra] != null
}, 40, 3)
console.log(`B sees A-channel (live push): ${Boolean(r2)}`)

const r3 = await pollUntil(() => TestFedHasReaction(FedB, gid, cid, eventIdA), 40, 3)
console.log(`B sees A-reaction (live push): ${Boolean(r3)}`)

const r4 = await pollUntil(async () => {
	const listResponse = await Api(FedA, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (listResponse.json.messages?.filter(row => row.eventId === eventIdB).length ?? 0) >= 1
}, 40, 3)
console.log(`A sees B-message (live push): ${Boolean(r4)}`)

console.log('\n--- peers snapshot ---')
const pa = (await Api(FedA, 'GET', `/groups/${gid}/peers`)).json
const pb = (await Api(FedB, 'GET', `/groups/${gid}/peers`)).json
console.log(`A: fed=${pa.federationEnabled} peers=${pa.peers?.length ?? 0} trusted=${pa.trustedPeers?.length ?? 0}`)
console.log(`B: fed=${pb.federationEnabled} peers=${pb.peers?.length ?? 0} trusted=${pb.trustedPeers?.length ?? 0}`)

await ClearFedGroup(gid)
console.log(`\ngroup=${gid} messageA=${Boolean(r1)} channel=${Boolean(r2)} React=${Boolean(r3)} messageB=${Boolean(r4)}`)
