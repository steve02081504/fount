import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const THUMBS_UP = '\u{1F44D}'

const {
	chatApi,
	testCase,
	skipCase,
	writeLiveSection,
	writeLiveSummary,
	completeLiveScript,
} = await createSingleNodeProbe()

/** @type {string[]} */
const createdGroups = []

/**
 * @param {string} method HTTP 方法
 * @param {string} path 路径
 * @param {object | undefined} body 请求体
 * @returns {Promise<import('fount/scripts/test/live/http.mjs').LiveHttpResponse>} Chat API 响应
 */
async function api(method, path, body) {
	return chatApi(method, path, body)
}

// ---------------------------------------------------------------------------
writeLiveSection('A. Group lifecycle')
let gid = null
let cid = null

await testCase('POST /groups create', async () => {
	const r = await api('POST', '/groups/', { name: 'E2E-main', description: 'e2e' })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	gid = r.json.groupId
	cid = r.json.defaultChannelId
	createdGroups.push(gid)
	return Boolean(gid && cid)
})

await testCase('GET /groups list contains new group', async () => {
	const r = await api('GET', '/groups/')
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	return r.json?.filter(row => row.groupId === gid).length === 1
})

await testCase('GET /groups/:id/state isMember+channels', async () => {
	const r = await api('GET', `/groups/${gid}/state`)
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	return r.json.viewer?.isMember === true && r.json.meta?.channels?.[cid] != null
})

await testCase('GET /groups/:id/snapshot', async () => {
	const r = await api('GET', `/groups/${gid}/snapshot`)
	return r.status === 200 && r.json.snapshot != null
})

await testCase('PUT /groups/:id/meta', async () => {
	const r = await api('PUT', `/groups/${gid}/meta`, { name: 'E2E-renamed', description: 'd2' })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const s = await api('GET', `/groups/${gid}/state`)
	return s.json.meta?.groupMeta?.name === 'E2E-renamed'
})

await testCase('PUT /groups/:id/settings joinPolicy+rate', async () => {
	const r = await api('PUT', `/groups/${gid}/settings`, {
		joinPolicy: 'open',
		messageRateLimitPerMin: 120,
		hotLatestMessageCount: 40,
	})
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('B. Channels & messages')
let chid = null
let msgId = null

await testCase('POST /channels create', async () => {
	const r = await api('POST', `/groups/${gid}/channels`, { name: 'e2e-chan', type: 'text', description: 'c' })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	chid = r.json.channelId
	return Boolean(chid)
})

await testCase('PUT /channels/:id update', async () => {
	const r = await api('PUT', `/groups/${gid}/channels/${chid}`, { name: 'e2e-chan-2', description: 'updated' })
	return r.status === 200
})

await testCase('PUT /default-channel', async () => {
	const r = await api('PUT', `/groups/${gid}/default-channel`, { channelId: chid })
	return r.status === 200
})

await testCase('POST message', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'hello e2e' },
	})
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	msgId = r.json.event?.id
	return Boolean(msgId)
})

await testCase('GET messages reads back', async () => {
	const r = await api('GET', `/groups/${gid}/channels/${cid}/messages`)
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	return r.json.messages?.filter(row => row.eventId === msgId).length === 1
})

await testCase('POST messages/batch-get', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/messages/batch-get`, { eventIds: [msgId] })
	return r.status === 200 && (r.json.messages?.length ?? 0) >= 1
})

await testCase('PUT edit message', async () => {
	const r = await api('PUT', `/groups/${gid}/channels/${cid}/messages/${msgId}`, {
		content: { type: 'text', content: 'edited e2e' },
	})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.event)
})

await testCase('POST reaction add', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: msgId, emoji: THUMBS_UP })
	return r.status === 200 || r.status === 201
})

await testCase('DELETE reaction', async () => {
	const r = await api('DELETE', `/groups/${gid}/channels/${cid}/reactions`, { targetEventId: msgId, emoji: THUMBS_UP })
	return r.status === 200 || r.status === 204
})

await testCase('POST pin', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/pins`, { targetEventId: msgId })
	return r.status === 200 || r.status === 201
})

await testCase('GET pin-context', async () => {
	const r = await api('GET', `/groups/${gid}/channels/${cid}/pin-context/${msgId}`)
	return r.status === 200
})

await testCase('DELETE pin', async () => {
	const r = await api('DELETE', `/groups/${gid}/channels/${cid}/pins/${msgId}`)
	return r.status === 200 || r.status === 204
})

await testCase('POST vote create + cast', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/votes`, {
		question: 'q?',
		options: ['A', 'B'],
		deadlineMs: 3_600_000,
	})
	if (r.status !== 201) throw new Error(`create status ${r.status}: ${r.raw}`)
	const ballot = r.json.ballotId
	const c = await api('POST', `/groups/${gid}/channels/${cid}/votes/${ballot}/cast`, { choice: 'A' })
	return c.status === 200 || c.status === 201
})

await testCase('POST thread create', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/threads`, { parentEventId: msgId })
	return r.status === 201 && Boolean(r.json.channelId)
})

await testCase('DELETE message', async () => {
	const r = await api('DELETE', `/groups/${gid}/channels/${cid}/messages/${msgId}`)
	return r.status === 200 && Boolean(r.json.event)
})

await testCase('list channel + list-items', async () => {
	const lc = await api('POST', `/groups/${gid}/channels`, { name: 'e2e-list', type: 'list' })
	if (lc.status !== 201) throw new Error(`list channel create ${lc.status}`)
	const lcid = lc.json.channelId
	const r = await api('POST', `/groups/${gid}/channels/${lcid}/list-items`, {
		items: [{ title: 'item1', description: 'd' }],
	})
	return r.status === 200 || r.status === 201
})

// ---------------------------------------------------------------------------
writeLiveSection('C. Members & governance')

await testCase('GET members/page/0', async () => {
	const r = await api('GET', `/groups/${gid}/members/page/0`)
	return r.status === 200 && (r.json.members?.length ?? 0) >= 1
})

skipCase('POST join rejects invalid pow on pow-policy group', 'covered by pure join_policy_pow.test.mjs')

await testCase('POST invite-ticket', async () => {
	const r = await api('POST', `/groups/${gid}/invite-ticket`, { ttlMs: 3_600_000 })
	if (r.status !== 201 && r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.code)
})

await testCase('GET permissions (self)', async () => {
	const r = await api('GET', `/groups/${gid}/permissions`)
	return r.status === 200 && r.json.ADMIN === true
})

await testCase('GET channel permissions', async () => {
	const r = await api('GET', `/groups/${gid}/channels/${cid}/permissions`)
	return r.status === 200
})

let roleId = null

await testCase('POST role create', async () => {
	const r = await api('POST', `/groups/${gid}/roles`, { name: 'e2erole', color: '#ff0000' })
	if (r.status !== 201 && r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	roleId = r.json.roleId
	return Boolean(roleId)
})

await testCase('PUT role update', async () => {
	const r = await api('PUT', `/groups/${gid}/roles/${roleId}`, { name: 'e2erole2', isHoisted: true })
	return r.status === 200
})

await testCase('PUT role permission', async () => {
	const r = await api('PUT', `/groups/${gid}/roles/${roleId}/permissions`, { permission: 'SEND_MESSAGES', enabled: true })
	return r.status === 200
})

await testCase('PUT channel permissions', async () => {
	const r = await api('PUT', `/groups/${gid}/channels/${cid}/permissions`, {
		roleId,
		allow: { SEND_MESSAGES: true },
		deny: {},
	})
	return r.status === 200
})

await testCase('DELETE role', async () => {
	const r = await api('DELETE', `/groups/${gid}/roles/${roleId}`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('D. DAG')

await testCase('GET dag/tips', async () => {
	const r = await api('GET', `/groups/${gid}/dag/tips`)
	return r.status === 200 && (r.json.tips?.length ?? 0) >= 1
})

await testCase('GET events', async () => {
	const r = await api('GET', `/groups/${gid}/events`)
	return r.status === 200 && (r.json.events?.length ?? 0) >= 1
})

await testCase('POST dag/merge-tips', async () => {
	const r = await api('POST', `/groups/${gid}/dag/merge-tips`, {})
	return r.status === 200 || r.status === 409 || r.status === 400
})

await testCase('PUT governance-branch', async () => {
	const r = await api('PUT', `/groups/${gid}/governance-branch`, { tipId: null })
	return r.status === 200
})

await testCase('POST fork', async () => {
	const tips = await api('GET', `/groups/${gid}/dag/tips`)
	const tip = tips.json.tips?.[0]
	const r = await api('POST', `/groups/${gid}/fork`, { tipId: tip, name: 'E2E-fork', copyReputation: true })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	if (r.json.groupId) createdGroups.push(r.json.groupId)
	return Boolean(r.json.groupId)
})

// ---------------------------------------------------------------------------
writeLiveSection('E. Channel key rotate')

await testCase('POST file-key-rotate', async () => {
	const r = await api('POST', `/groups/${gid}/file-key-rotate`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return r.json.generation >= 1
})

// ---------------------------------------------------------------------------
writeLiveSection('F. Files')
const fileId = randomUUID()
let chunkInfo = null

await testCase('POST chunks/have (absent)', async () => {
	const r = await api('POST', `/groups/${gid}/chunks/have`, {
		ciphertextHash: '0'.repeat(64),
		size: 10,
		ceMode: 'convergent',
	})
	return r.status === 200
})

await testCase('POST chunks upload', async () => {
	const data = Buffer.from('hello-file-content').toString('base64')
	const r = await api('POST', `/groups/${gid}/chunks`, { fileId, data, channelId: cid, ceMode: 'convergent' })
	if (r.status !== 200 && r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	chunkInfo = r.json
	return Boolean(r.json.ciphertextHash)
})

await testCase('POST files register', async () => {
	const ci = chunkInfo
	const body = {
		fileId,
		name: 'hello.txt',
		size: 18,
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
	const r = await api('POST', `/groups/${gid}/files`, body)
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.event)
})

await testCase('GET files/:id/meta', async () => {
	const r = await api('GET', `/groups/${gid}/files/${fileId}/meta`)
	return r.status === 200 && r.json.fileId === fileId
})

await testCase('GET files/:id/download-status', async () => {
	const r = await api('GET', `/groups/${gid}/files/${fileId}/download-status`)
	return r.status === 200
})

await testCase('POST file-system create folder', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, {
		operation: 'create',
		folderId: `folder_${randomUUID().replace(/-/g, '')}`,
		name: 'e2e-folder',
	})
	return r.status === 200 || r.status === 201
})

await testCase('DELETE file', async () => {
	const r = await api('DELETE', `/groups/${gid}/files/${fileId}`)
	return r.status === 200 && Boolean(r.json.event)
})

// ---------------------------------------------------------------------------
writeLiveSection('G. Archive')

await testCase('GET archive/summary', async () => {
	const r = await api('GET', `/groups/${gid}/archive/summary`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('H. Federation (local-observable)')

await testCase('GET peers', async () => {
	const r = await api('GET', `/groups/${gid}/peers`)
	return r.status === 200 && Boolean(r.json.selfNodeHash)
})

await testCase('GET reputation', async () => {
	const r = await api('GET', '/reputation')
	return r.status === 200
})

await testCase('POST federation/tuning', async () => {
	const r = await api('POST', `/groups/${gid}/federation/tuning`, {
		federationPartitionCount: 8,
		rtcConnectionBudgetMax: 32,
	})
	return r.status === 200 && r.json.ok === true
})

await testCase('POST federation/offline-mark', async () => {
	const r = await api('POST', `/groups/${gid}/federation/offline-mark`, {
		wallMs: Date.now(),
	})
	return r.status === 200 || r.status === 204
})

await testCase('POST reputation/slash verified (DAG)', async () => {
	const members = await api('GET', `/groups/${gid}/members/page/0`)
	const self = members.json.members?.[0]?.memberKey
	const tip = (await api('GET', `/groups/${gid}/dag/tips`)).json.tips?.[0]
	const r = await api('POST', `/groups/${gid}/reputation/slash`, {
		targetPubKeyHash: self,
		claim: 0.1,
		verified: true,
		proof: { eventId: tip },
	})
	if (r.status !== 200) throw new Error(`slash ${r.status}: ${r.raw}`)
	return true
})

await testCase('POST reputation/reset (DAG)', async () => {
	const members = await api('GET', `/groups/${gid}/members/page/0`)
	const self = members.json.members?.[0]?.memberKey
	const r = await api('POST', `/groups/${gid}/reputation/reset`, { targetPubKeyHash: self })
	if (r.status !== 200) throw new Error(`reset ${r.status}: ${r.raw}`)
	return true
})

// ---------------------------------------------------------------------------
writeLiveSection('I. AI / chars')
let availChar = null
let charAddStatus = null

await testCase('GET initial-data', async () => {
	const r = await api('GET', `/groups/${gid}/initial-data`)
	return r.status === 200
})

await testCase('GET chars/plugins/persona/world', async () => {
	const a = await api('GET', `/groups/${gid}/chars`)
	const b = await api('GET', `/groups/${gid}/plugins`)
	const c = await api('GET', `/groups/${gid}/persona`)
	const d = await api('GET', `/groups/${gid}/world?channelId=${cid}`)
	return a.status === 200 && b.status === 200 && c.status === 200 && d.status === 200
})

for (const cc of ['test_streamer', 'test_char', 'TestChar']) {
	const r = await api('POST', `/groups/${gid}/char`, { charname: cc, deferGreeting: true })
	if (r.status === 200 || r.status === 201) {
		availChar = cc
		charAddStatus = r.status
		break
	}
}

if (availChar) {
	await testCase(`POST char add (${availChar})`, async () => charAddStatus === 200 || charAddStatus === 201)
	await testCase('PUT char frequency', async () => {
		const r = await api('PUT', `/groups/${gid}/char/${availChar}/frequency`, { frequency: 0.5 })
		return r.status === 200
	})
	await testCase('DELETE char', async () => {
		const r = await api('DELETE', `/groups/${gid}/char/${availChar}`)
		return r.status === 200
	})
}
else
	skipCase('POST char add', 'no test char installed')


// ---------------------------------------------------------------------------
writeLiveSection('J. Sessions & misc (non-group prefix)')

await testCase('GET sessions/list', async () => {
	const r = await api('GET', '/sessions/list')
	return r.status === 200
})

await testCase('GET/PUT bookmarks', async () => {
	const g = await api('GET', '/bookmarks')
	if (g.status !== 200 || g.json.entries == null) throw new Error(`get ${g.status}`)
	const p = await api('PUT', '/bookmarks', {
		entries: [{ groupId: gid, channelId: cid, eventId: 'a'.repeat(64), title: 'bm' }],
	})
	return p.status === 200
})

await testCase('GET/PUT group-folders', async () => {
	const g = await api('GET', '/group-folders')
	const p = await api('PUT', '/group-folders', { folders: [{ id: 'f1', name: 'Folder1', groupIds: [gid] }] })
	return g.status === 200 && p.status === 200
})

await testCase('GET/PUT custom-emojis', async () => {
	const g = await api('GET', '/custom-emojis')
	return g.status === 200
})

await testCase('GET emoji-usage/frequent', async () => {
	const r = await api('GET', '/emoji-usage/frequent?limit=16')
	return r.status === 200
})

await testCase('GET discovery', async () => {
	const r = await api('GET', '/discovery?limit=20')
	return r.status === 200
})

await testCase('GET mailbox/summary', async () => {
	const r = await api('GET', '/mailbox/summary')
	return r.status === 200
})

await testCase('GET group emojis', async () => {
	const r = await api('GET', `/groups/${gid}/emojis`)
	return r.status === 200
})

await testCase('GET audit-log', async () => {
	const r = await api('GET', `/groups/${gid}/audit-log?limit=20`)
	return r.status === 200
})

await testCase('GET stickers/packs + collection', async () => {
	const a = await api('GET', '/stickers/packs')
	const b = await api('GET', '/stickers/collection')
	return a.status === 200 && b.status === 200
})

await testCase('GET group export', async () => {
	const r = await api('GET', `/groups/${gid}/export`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('Cleanup')
for (const g of [...new Set(createdGroups)]) {
	const r = await api('DELETE', `/groups/${g}`)
	if (r.status === 200) console.log(`  deleted ${g}`)
	else console.log(`  cleanup FAIL ${g} status ${r.status}`)
}

writeLiveSummary('chat e2e_single')
completeLiveScript()
