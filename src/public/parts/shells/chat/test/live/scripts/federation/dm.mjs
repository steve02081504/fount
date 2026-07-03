/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns, jsdoc/require-param-description, jsdoc/require-param-type */
import { join as joinPath } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { denoLiveRun } from 'fount/scripts/test/live/deno_run.mjs'
import { ms } from 'fount/scripts/ms.mjs'
import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	P2pApi,
	PollUntil,
	RootApi,
	testCase,
	WaitFedMembers,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

/** @typedef {import('fount/scripts/test/live/http.mjs').LiveNodeHandle} LiveNodeHandle */

async function getIdentity(node) {
	const r = await P2pApi(node, 'GET', '/federation')
	if (r.status !== 200) throw new Error(`federation GET ${r.status}`)
	return String(r.json.activePubKeyHex).toLowerCase()
}

async function getWhoamiUser(node) {
	const r = await RootApi(node, 'GET', '/api/whoami')
	if (r.status !== 200) throw new Error(`whoami ${r.status}`)
	return r.json.username
}

async function buildDmIntro(node) {
	const user = await getWhoamiUser(node)
	const dataPath = node.dataPath
	const repoRoot = process.env.FOUNT_TEST_REPO_ROOT
	if (!repoRoot) throw new Error('FOUNT_TEST_REPO_ROOT required for dm intro helper')
	const helper = joinPath(fileURLToPath(new URL('.', import.meta.url)), 'dm_intro_helper.mjs')
	const argv = [...denoLiveRun(helper), '--data-path', dataPath, '--user', user]
	const cmd = new Deno.Command(argv[0], {
		args: argv.slice(1),
		cwd: repoRoot,
		stdout: 'piped',
		stderr: 'piped',
	})
	const { code, stdout, stderr } = await cmd.output()
	const out = new TextDecoder().decode(stdout)
	if (code !== 0) throw new Error(`dm intro helper failed: ${new TextDecoder().decode(stderr) || out}`)
	return JSON.parse(out.trim())
}

async function resolveUsableChannelId(node, gid, currentCid) {
	if (currentCid) return currentCid
	return PollUntil(120, 3, async () => {
		const st = await Api(node, 'GET', `/groups/${gid}/state`)
		if (st.status !== 200) return null
		const defaultCid = st.json.meta?.groupSettings?.defaultChannelId
		if (defaultCid) return defaultCid
		const channels = st.json.meta?.channels
		if (channels) {
			const chNames = Object.keys(channels)
			if (chNames.length >= 1) return chNames[0]
		}
		return null
	})
}

console.log('=== Setup: identities + DM intro ===')
const aPub = await getIdentity(FedA)
const bPub = await getIdentity(FedB)
console.log(`A identity=${aPub}`)
console.log(`B identity=${bPub}`)

/** @type {LiveNodeHandle} */
let creator
/** @type {LiveNodeHandle} */
let joiner
let creatorPub
let peerPub

if (aPub < bPub) {
	creator = FedA
	joiner = FedB
	creatorPub = aPub
	peerPub = bPub
}
else {
	creator = FedB
	joiner = FedA
	creatorPub = bPub
	peerPub = aPub
}
console.log(`DM creator=${creator.name} (lower pubkey)`)

for (const node of [creator, joiner]) {
	const list = await Api(node, 'GET', '/groups/')
	if (list.status !== 200) continue
	for (const row of list.json ?? []) 
		if (String(row.name ?? '').startsWith('DM ·')) 
			await Api(node, 'DELETE', `/groups/${row.groupId}`)
		
	
}
const dmReady = await PollUntil(10, 0.5, async () => {
	const list = await Api(creator, 'GET', '/groups/')
	return list.status === 200 && (list.json?.filter(row => String(row.name ?? '').startsWith('DM ·')).length ?? 0) === 0
})
if (!dmReady) throw new Error('stale DM groups not cleaned up before test')

const intro = await buildDmIntro(creator)

let gid = null
let cid = null
/** @type {Record<string, unknown>} */
let dmInv = null

console.log('\n=== 1. Creator opens DM group ===')
await testCase('lower-pubkey node POST template=dm', async () => {
	const r = await Api(creator, 'POST', '/groups/', {
		template: 'dm',
		myPubKeyHex: creatorPub,
		peerPubKeyHex: peerPub,
	})
	if (r.status !== 201) throw new Error(`create ${r.status}: ${r.raw}`)
	gid = r.json.groupId
	cid = r.json.defaultChannelId
	return Boolean(gid && cid)
})

console.log('\n=== 2. Peer joins DM (intro + room creds) ===')
await testCase('invite-ticket room creds on creator', async () => {
	const inv = await Api(creator, 'POST', `/groups/${gid}/invite-ticket`, { ttlMs: ms('1h') })
	if (inv.status !== 201 && inv.status !== 200) throw new Error(`invite ${inv.status}`)
	dmInv = inv.json
	return Boolean(dmInv?.roomSecret)
})

await testCase('peer join with dmIntro proof', async () => {
	const joined = await PollUntil(120, 4, async () => {
		const jr = await Api(joiner, 'POST', `/groups/${gid}/join`, {
			roomSecret: dmInv.roomSecret,
			signalingAppId: dmInv.signalingAppId,
			dmSessionTag: dmInv.dmSessionTag,
			introducerPubKeyHash: intro.pubKeyHex,
			dmIntroNonce: intro.dmIntroNonce,
			dmIntroSignatureHex: intro.dmIntroSignatureHex,
		})
		if (jr.status === 200) return jr
		console.log(`    join retry status=${jr.status} body=${jr.raw}`)
		return false
	})
	if (!joined) throw new Error('join did not return 200')
	if (joined.json?.defaultChannelId) cid = joined.json.defaultChannelId
	return PollUntil(180, 4, async () => {
		await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('6s') })
		await Api(creator, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('6s') })
		await Api(joiner, 'POST', `/groups/${gid}/dag/merge-tips`, {})
		const st = await Api(joiner, 'GET', `/groups/${gid}/state`)
		if (st.json.meta?.groupSettings?.defaultChannelId) 
			cid = st.json.meta.groupSettings.defaultChannelId
		
		else if (st.json.meta?.channels) {
			const chNames = Object.keys(st.json.meta.channels)
			if (chNames.length >= 1) cid = chNames[0]
		}
		return Object.keys(st.json.meta?.channels ?? {}).length >= 1
	})
})

console.log('\n=== 3. Federation health gate ===')
await testCase('joiner join-snapshot + catchup', async () => {
	await Api(joiner, 'POST', `/groups/${gid}/federation/join-snapshot`, {})
	const r = await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('25s') })
	return r.status === 200
})

await testCase('creator join-snapshot + catchup sees joiner', async () => {
	const joinerSt = await Api(joiner, 'GET', `/groups/${gid}/state`)
	if (joinerSt.status !== 200) throw new Error(`joiner state ${joinerSt.status}`)
	const joinerHash = String(joinerSt.json.viewer?.memberKey ?? '')
	if (!joinerHash) throw new Error('joiner viewerMemberPubKeyHash missing')
	await Api(creator, 'POST', `/groups/${gid}/federation/join-snapshot`, {})
	const r = await Api(creator, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('25s') })
	if (r.status !== 200) throw new Error(`catchup ${r.status}`)
	await Api(creator, 'POST', `/groups/${gid}/dag/merge-tips`, {})
	await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('12s') })
	await Api(joiner, 'POST', `/groups/${gid}/dag/merge-tips`, {})
	return PollUntil(120, 3, async () => {
		await Api(creator, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('8s') })
		await Api(creator, 'POST', `/groups/${gid}/dag/merge-tips`, {})
		const s = await Api(creator, 'GET', `/groups/${gid}/state`)
		if (s.status !== 200) return false
		return (s.json.meta?.members?.filter(m => m.memberKey === joinerHash).length ?? 0) >= 1
	})
})

await testCase('creator members>=2 after DM join', async () => WaitFedMembers(creator, gid, 2, 120))

await testCase('joiner state has default channel', async () => PollUntil(90, 3, async () => {
	await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('4s') })
	const s = await Api(joiner, 'GET', `/groups/${gid}/state`)
	if (s.json.meta?.groupSettings?.defaultChannelId) 
		cid = s.json.meta.groupSettings.defaultChannelId
	
	else if (s.json.meta?.channels) {
		const chNames = Object.keys(s.json.meta.channels)
		if (chNames.length >= 1) cid = chNames[0]
	}
	return s.status === 200 && Object.keys(s.json.meta?.channels ?? {}).length >= 1
}))

console.log('\n=== 4. Bidirectional messages ===')
let aMsg = null
let bMsg = null

await testCase('creator sends DM-A', async () => {
	cid = await resolveUsableChannelId(creator, gid, cid)
	if (!cid) throw new Error('creator channel not materialized')
	const r = await Api(creator, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'dm-A-to-B' },
	})
	if (r.status !== 201) throw new Error(`send ${r.status}`)
	aMsg = r.json.event?.id
	return Boolean(aMsg)
})

await testCase('joiner sees dm-A (catchup/live)', async () => PollUntil(90, 3, async () => {
	await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('3s') })
	const m = await Api(joiner, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return m.status === 200 && (m.json.messages?.filter(row => row.eventId === aMsg).length ?? 0) >= 1
}))

await testCase('joiner sends DM-B', async () => {
	const ready = await PollUntil(90, 3, async () => {
		await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('4s') })
		const s = await Api(joiner, 'GET', `/groups/${gid}/state`)
		if (s.json.meta?.groupSettings?.defaultChannelId) 
			cid = s.json.meta.groupSettings.defaultChannelId
		
		else if (s.json.meta?.channels) {
			const chNames = Object.keys(s.json.meta.channels)
			if (chNames.length >= 1) cid = chNames[0]
		}
		return s.status === 200 && Object.keys(s.json.meta?.channels ?? {}).length >= 1
	})
	if (!ready) throw new Error('joiner channels not materialized')
	const r = await Api(joiner, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'dm-B-to-A' },
	})
	if (r.status !== 201) throw new Error(`send ${r.status}: ${r.raw}`)
	bMsg = r.json.event?.id
	return Boolean(bMsg)
})

await testCase('creator sees dm-B', async () => PollUntil(90, 3, async () => {
	await Api(creator, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('3s') })
	const m = await Api(creator, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return m.status === 200 && (m.json.messages?.filter(row => row.eventId === bMsg).length ?? 0) >= 1
}))

await ClearFedGroup(gid)
WriteFedSummary('FED-DM', gid)
completeLiveScript()
