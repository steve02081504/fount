import { ms } from 'fount/scripts/ms.mjs'
import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedC,
	InitializeOpenGroupJoinMulti,
	PollUntil,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

if (!FedC) throw new Error('fed_ban requires FOUNT_TEST_NODE_COUNT >= 3')

console.log('=== Setup: open group + join A/B/C ===')
const setup = await InitializeOpenGroupJoinMulti('FedBan', 'ban-seed-abc', [FedB, FedC])
const gid = setup.groupId
const cid = setup.channelId
let bPub = null
let banEventId = null

console.log('\n=== 1. Resolve B member pubkey ===')
await testCase('resolve B pubKeyHash from B state', async () => {
	const st = await Api(FedB, 'GET', `/groups/${gid}/state`)
	if (st.status !== 200) throw new Error(`state ${st.status}`)
	bPub = st.json.viewer?.memberKey
	return Boolean(bPub)
})

console.log('\n=== 2. A bans B (entity) ===')
await testCase('A memberCount >= 3 before ban', async () => {
	const s = await Api(FedA, 'GET', `/groups/${gid}/state`)
	return s.status === 200 && Number(s.json.meta?.memberCount) >= 3
})

await testCase('A POST members/:hash/ban entity', async () => {
	const k = await Api(FedA, 'POST', `/groups/${gid}/members/${encodeURIComponent(bPub)}/ban`, { banScope: 'entity' })
	if (k.status !== 200) throw new Error(`ban ${k.status}: ${k.raw}`)
	await Api(FedA, 'POST', `/groups/${gid}/dag/merge-tips`, {})
	await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('6s') })
	return true
})

await testCase('A state lists B in bannedMembers', async () => {
	const ok = await PollUntil(30, 2, async () => {
		const s = await Api(FedA, 'GET', `/groups/${gid}/state`)
		return (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) >= 1
	})
	return Boolean(ok)
})

console.log('\n=== 3. C receives ban via federation ===')
await testCase('C catchup receives ban (third-party sync)', async () => {
	const ok = await PollUntil(180, 4, async () => {
		for (const node of [FedA, FedC]) 
			await Api(node, 'POST', `/groups/${gid}/federation/rebind`, {})
		
		await Api(FedA, 'POST', `/groups/${gid}/dag/merge-tips`, {})
		await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('8s') })
		const ev = await Api(FedA, 'GET', `/groups/${gid}/events?limit=40`)
		if (ev.status === 200) {
			const banRows = ev.json.events?.filter(e => e.type === 'member_ban') ?? []
			if (banRows.length) banEventId = banRows[banRows.length - 1].id
		}
		await Api(FedC, 'POST', `/groups/${gid}/federation/join-snapshot`, {})
		const body = { waitMs: ms('10s') }
		if (banEventId) body.extraWantIds = [banEventId]
		await Api(FedC, 'POST', `/groups/${gid}/federation/catchup`, body)
		await Api(FedC, 'POST', `/groups/${gid}/dag/merge-tips`, {})
		const s = await Api(FedC, 'GET', `/groups/${gid}/state`)
		if (s.status !== 200) return false
		return (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) >= 1
	})
	if (!ok) throw new Error('C must receive member_ban via normal federation catchup')
	return true
})

console.log('\n=== 4. B probes peers and self-judges removed ===')
await testCase('B catchup probes shunned by A and C -> suspectedRemoved', async () => {
	const ok = await PollUntil(180, 4, async () => {
		for (const node of [FedB, FedA, FedC]) 
			await Api(node, 'POST', `/groups/${gid}/federation/rebind`, {})
		
		const r = await Api(FedB, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('15s') })
		if (r.status !== 200) return false
		if (r.json.suspectedRemoved === true) return true
		const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
		return s.status === 200 && s.json.viewer?.suspectedRemoved === true
	})
	if (!ok) throw new Error('B must suspect removal after shuns from known member nodes')
	return true
})

await testCase('B state does not materialize ban event locally', async () => {
	const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
	return (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) === 0
})

console.log('\n=== 5. B cannot send; A roster clean ===')
await testCase('B POST message rejected after suspectedRemoved (403)', async () => {
	const ok = await PollUntil(30, 2, async () => {
		const s = await Api(FedB, 'GET', `/groups/${gid}/state`)
		if (s.status !== 200 || s.json.viewer?.suspectedRemoved !== true) return false
		const r = await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
			content: { type: 'text', content: 'banned-attempt' },
		})
		return r.status === 403
	})
	if (!ok) throw new Error('B must be suspectedRemoved and get 403 on POST message')
	return true
})

await testCase('A channel has no banned-attempt message', async () => {
	const ok = await PollUntil(30, 3, async () => {
		await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('4s') })
		const m = await Api(FedA, 'GET', `/groups/${gid}/channels/${cid}/messages?limit=80`)
		if (m.status !== 200) return false
		return (m.json.messages?.filter(row => String(row.content?.content).includes('banned-attempt')).length ?? 0) === 0
	})
	return Boolean(ok)
})

await testCase('A events keep member_ban and no unban rollback', async () => {
	const ev = await Api(FedA, 'GET', `/groups/${gid}/events?limit=60`)
	if (ev.status !== 200) return false
	const banN = ev.json.events?.filter(e => e.type === 'member_ban').length ?? 0
	const unbanN = ev.json.events?.filter(e => e.type === 'member_unban').length ?? 0
	return banN >= 1 && unbanN === 0
})

await testCase('A can still send after ban', async () => {
	const r = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'after-ban-A' },
	})
	return r.status === 201
})

await ClearFedGroup(gid)
WriteFedSummary('FED-BAN', gid)
completeLiveScript()
