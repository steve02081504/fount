import {
	Api,
	ClearFedGroup,
	FedA,
	FedB,
} from 'fount/scripts/test/live/federation/common.mjs'
import { sleep } from 'fount/scripts/test/live/http.mjs'

const g = (await Api(FedA, 'POST', '/groups/', { name: 'CatchupProbe' })).json
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
console.log(`group=${gid} joined; waiting 14s for join-time catch-up to settle...`)
await sleep(14_000)

const m1 = (await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'catchup-M1' },
})).json.event?.id
console.log(`A created post-join M1=${m1}`)

let auto = false
let i = 0
for (i = 0; i < 9; i++) {
	await sleep(3000)
	const msgs = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	if ((msgs.json.messages?.filter(row => row.eventId === m1).length ?? 0) >= 1) {
		auto = true
		break
	}
}
console.log(`B sees M1 WITHOUT explicit catchup (live/heartbeat): ${auto}  (after ~${i * 3}s)`)

let expl = false
for (let k = 0; k < 6; k++) {
	const cu = await Api(FedB, 'POST', `/groups/${gid}/federation/catchup`, {})
	console.log(`  explicit catchup #${k} -> status ${cu.status}`)
	await sleep(4000)
	const msgs = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	if ((msgs.json.messages?.filter(row => row.eventId === m1).length ?? 0) >= 1) {
		expl = true
		break
	}
}
console.log(`B sees M1 AFTER explicit catchup: ${expl}`)

const pa = (await Api(FedA, 'GET', `/groups/${gid}/peers`)).json
const pb = (await Api(FedB, 'GET', `/groups/${gid}/peers`)).json
console.log(`peers  A: fed=${pa.federationEnabled} peers=${pa.peers?.length ?? 0}  B: fed=${pb.federationEnabled} peers=${pb.peers?.length ?? 0}`)
await ClearFedGroup(gid)
console.log(`RESULT auto=${auto} explicit=${expl}`)
