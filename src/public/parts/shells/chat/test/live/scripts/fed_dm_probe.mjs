/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns, jsdoc/require-param-description, jsdoc/require-param-type */
import { join as joinPath } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { denoLiveRun } from 'fount/scripts/test/live/deno_run.mjs'
import {
	Api,
	FedA,
	FedB,
	P2pApi,
	RootApi,
} from 'fount/scripts/test/live/federation/common.mjs'

/** @typedef {import('fount/scripts/test/live/http.mjs').LiveNodeHandle} LiveNodeHandle */

/** @param {LiveNodeHandle} node */
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
	const helper = joinPath(fileURLToPath(new URL('.', import.meta.url)), 'federation', 'dm_intro_helper.mjs')
	const repoRoot = process.env.FOUNT_TEST_REPO_ROOT
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

const aPub = await getIdentity(FedA)
const bPub = await getIdentity(FedB)

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

console.log(`creator=${creator.name} creatorPub=${creatorPub}`)
console.log(`joiner=${joiner.name} peerPub=${peerPub}`)

const intro = await buildDmIntro(creator)
console.log(`intro.pubKeyHex=${intro.pubKeyHex}`)

const create = await Api(creator, 'POST', '/groups/', {
	template: 'dm',
	myPubKeyHex: creatorPub,
	peerPubKeyHex: peerPub,
})
if (create.status !== 201) throw new Error(`create failed: ${create.status} ${create.raw}`)
const gid = create.json.groupId
const cid = create.json.defaultChannelId
console.log(`gid=${gid} cid=${cid}`)

const inv = await Api(creator, 'POST', `/groups/${gid}/invite-ticket`, { ttlMs: 3_600_000 })
console.log(`invite status=${inv.status}`)

const joinResp = await Api(joiner, 'POST', `/groups/${gid}/join`, {
	roomSecret: inv.json.roomSecret,
	signalingAppId: inv.json.signalingAppId,
	introducerPubKeyHash: intro.pubKeyHex,
	dmIntroNonce: intro.dmIntroNonce,
	dmIntroSignatureHex: intro.dmIntroSignatureHex,
})
console.log(`join status=${joinResp.status} body=${joinResp.raw}`)

for (let i = 0; i < 8; i++) {
	await Api(joiner, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: 6000 })
	await Api(joiner, 'POST', `/groups/${gid}/dag/merge-tips`, {})
	await Api(creator, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: 6000 })
	await Api(creator, 'POST', `/groups/${gid}/dag/merge-tips`, {})
}

const sA = await Api(creator, 'GET', `/groups/${gid}/state`)
const sB = await Api(joiner, 'GET', `/groups/${gid}/state`)

console.log('\n=== A state ===')
console.log(`status=${sA.status} isMember=${sA.json.viewer?.isMember} memberCount=${sA.json.meta?.memberCount} defaultChannel=${sA.json.meta?.groupSettings?.defaultChannelId}`)
for (const m of sA.json.meta?.members ?? []) 
	console.log(` A-member ${m.memberKey} roles=${(m.roles ?? []).join(',')} status=${m.status}`)


console.log('\n=== B state ===')
console.log(`status=${sB.status} isMember=${sB.json.viewer?.isMember} memberCount=${sB.json.meta?.memberCount} defaultChannel=${sB.json.meta?.groupSettings?.defaultChannelId}`)
for (const m of sB.json.meta?.members ?? []) 
	console.log(` B-member ${m.memberKey} roles=${(m.roles ?? []).join(',')} status=${m.status}`)


const evA = await Api(creator, 'GET', `/groups/${gid}/events?limit=200`)
const evB = await Api(joiner, 'GET', `/groups/${gid}/events?limit=200`)

console.log('\n=== A events ===')
for (const e of evA.json.events ?? []) {
	let extra = ''
	if (e.type === 'member_join') 
		extra = ` sender=${e.sender} intro=${e.content?.introducerPubKeyHash} dmNonce=${String(e.content?.dmIntroNonce ?? '')}`
	
	console.log(` A-ev ${e.type} id=${String(e.id).slice(0, 8)}${extra}`)
}

console.log('\n=== B events ===')
for (const e of evB.json.events ?? []) {
	let extra = ''
	if (e.type === 'member_join') 
		extra = ` sender=${e.sender} intro=${e.content?.introducerPubKeyHash} dmNonce=${String(e.content?.dmIntroNonce ?? '')}`
	
	console.log(` B-ev ${e.type} id=${String(e.id).slice(0, 8)}${extra}`)
}

console.log(`\n(Probe finished without cleanup) gid=${gid}`)
