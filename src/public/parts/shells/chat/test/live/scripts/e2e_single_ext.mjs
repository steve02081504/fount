import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns, jsdoc/require-param-description, jsdoc/require-param-type */
import { TEST_PNG_BYTES, testPngDataUrl } from 'fount/scripts/test/live/http.mjs'
import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const {
	chatApi,
	chatApiMultipart,
	pollUntil,
	testCase,
	writeLiveSection,
	writeLiveSummary,
	completeLiveScript,
} = await createSingleNodeProbe()

/** @type {string[]} */
const createdGroups = []
const pngBytes = TEST_PNG_BYTES
const pngDataUrl = testPngDataUrl()

async function api(method, path, body) {
	return chatApi(method, path, body, 120)
}

function okStatus(status, allowed = [200, 201]) {
	return allowed.includes(status)
}

async function ensureTestChar(groupId) {
	for (const cc of ['test_streamer', 'test_char', 'TestChar']) {
		const r = await api('POST', `/groups/${groupId}/char`, { charname: cc, deferGreeting: true })
		if (okStatus(r.status)) return cc
	}
	return null
}

async function requireTestChar(groupId) {
	const char = await ensureTestChar(groupId)
	if (!char) throw new Error('test_streamer char must be available (live fixture copy failed)')
	return char
}

async function triggerCharReply(groupId, channelId, charname) {
	if (!charname) return false
	const r = await api('POST', `/groups/${groupId}/channels/${channelId}/trigger-reply`, { charname })
	return okStatus(r.status)
}

async function getLatestCharMessageId(groupId, channelId) {
	const r = await api('GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (r.status !== 200) return null
	const rows = r.json.messages?.filter(row => row.charId) ?? []
	if (!rows.length) return null
	return rows[rows.length - 1].eventId
}

async function waitForCharMessageId(groupId, channelId, charname, timeoutSec = 90) {
	await triggerCharReply(groupId, channelId, charname)
	let found = null
	const ok = await pollUntil(async () => {
		found = await getLatestCharMessageId(groupId, channelId)
		return Boolean(found)
	}, timeoutSec, 0.5)
	return ok ? found : null
}

// ---------------------------------------------------------------------------
writeLiveSection('Setup — shared E2E-ext group')
let gid = null
let cid = null
let fbMsgId = null

await testCase('POST /groups create (ext)', async () => {
	const r = await api('POST', '/groups/', { name: 'E2E-ext', description: 'ext coverage' })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	gid = r.json.groupId
	cid = r.json.defaultChannelId
	createdGroups.push(gid)
	return Boolean(gid && cid)
})

await testCase('warm runtime (initial-data)', async () => {
	const r = await api('GET', `/groups/${gid}/initial-data`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('A. Channels & messages (gaps)')
let delChId = null
let delGroupId = null
const fbChar = await requireTestChar(gid)
fbMsgId = await waitForCharMessageId(gid, cid, fbChar, 90)
if (!fbMsgId) throw new Error(`char message required for feedback tests (char=${fbChar})`)

await testCase('PUT messages/:id/feedback up', async () => {
	const r = await api('PUT', `/groups/${gid}/channels/${cid}/messages/${fbMsgId}/feedback`, { type: 'up', content: 'helpful' })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.event)
})

await testCase('PUT messages/:id/feedback down', async () => {
	const r = await api('PUT', `/groups/${gid}/channels/${cid}/messages/${fbMsgId}/feedback`, { type: 'down' })
	return r.status === 200 && Boolean(r.json.event)
})

await testCase('POST message (user)', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'ext user msg' },
	})
	return okStatus(r.status)
})

await testCase('POST /compact', async () => {
	const r = await api('POST', `/groups/${gid}/compact`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return r.json.eventsPruned != null
})

await testCase('POST /events/local (local batch peer_invite)', async () => {
	const st = await api('GET', `/groups/${gid}/state`)
	const selfHash = st.json.viewer?.memberKey
	if (!selfHash) throw new Error('viewerMemberPubKeyHash missing')
	const fakePeer = 'b'.repeat(64)
	const r = await api('POST', `/groups/${gid}/events/local`, {
		events: [{
			type: 'peer_invite',
			timestamp: Date.now(),
			content: { from: selfHash, to: fakePeer },
		}],
	})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Number(r.json.applied) >= 1
})

let tlBefore = null
await testCase('GET /branch baseline', async () => {
	const r = await api('GET', `/groups/${gid}/branch`)
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	tlBefore = { current: Number(r.json.current), total: Number(r.json.total) }
	return tlBefore.total >= 1
})

await waitForCharMessageId(gid, cid, fbChar, 90)

let tlDeltaPlus = null
await testCase('PUT /branch delta +1', async () => {
	const r = await api('PUT', `/groups/${gid}/branch`, { delta: 1, channelId: cid })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	tlDeltaPlus = r
	return Boolean(r.json.entry)
})

await testCase('GET /branch after +1', async () => {
	if (tlDeltaPlus.json.entry) {
		const g = await api('GET', `/groups/${gid}/branch`)
		if (g.status !== 200) return false
		return Number(g.json.current) !== tlBefore.current || Number(g.json.total) > tlBefore.total
	}
	const ok = await pollUntil(async () => {
		const g = await api('GET', `/groups/${gid}/branch`)
		return g.status === 200 && (
			Number(g.json.current) !== tlBefore.current ||
			Number(g.json.total) > tlBefore.total
		)
	}, 45)
	if (!ok) throw new Error('timeline did not change after delta +1')
	return true
})

await testCase('PUT /branch delta -1', async () => {
	const r = await api('PUT', `/groups/${gid}/branch`, { delta: -1, channelId: cid })
	return r.status === 200 && Boolean(r.json.entry)
})

await testCase('GET /branch restored index', async () => {
	const g = await api('GET', `/groups/${gid}/branch`)
	return g.status === 200 && Number(g.json.current) === tlBefore.current
})

await testCase('POST channel (to delete)', async () => {
	const group = await api('POST', '/groups/', { name: 'E2E-ext-del', description: 'channel delete coverage' })
	if (group.status !== 201) throw new Error(`group ${group.status}: ${group.raw}`)
	delGroupId = group.json.groupId
	createdGroups.push(delGroupId)
	const channel = await api('POST', `/groups/${delGroupId}/channels`, { name: 'ext-del', type: 'text', description: 'tmp' })
	if (channel.status !== 201) throw new Error(`channel ${channel.status}: ${channel.raw}`)
	delChId = channel.json.channelId
	return Boolean(delGroupId && delChId)
})

await testCase('DELETE /channels/:id (non-default)', async () => {
	const r = await api('DELETE', `/groups/${delGroupId}/channels/${delChId}`)
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const ok = await pollUntil(async () => {
		const s = await api('GET', `/groups/${delGroupId}/state`)
		return s.status === 200 && s.json.meta?.channels?.[delChId] == null
	}, 20)
	if (!ok) throw new Error('channel still present after delete')
	return true
})

// ---------------------------------------------------------------------------
writeLiveSection('C. Files — file-system / download-resume / archive delete')
const fsFolderA = `folder_${randomUUID().replace(/-/g, '')}`
const fsFolderB = `folder_${randomUUID().replace(/-/g, '')}`
const dlFileId = randomUUID()
let dlChunk = null

await testCase('POST file-system create folder A', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, { operation: 'create', folderId: fsFolderA, name: 'ext-fs-a' })
	return r.status === 200 || r.status === 201
})

await testCase('POST file-system create folder B', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, { operation: 'create', folderId: fsFolderB, name: 'ext-fs-b' })
	return r.status === 200 || r.status === 201
})

await testCase('POST file-system rename A', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, { operation: 'rename', folderId: fsFolderA, name: 'ext-fs-a-renamed' })
	return r.status === 200 || r.status === 201
})

await testCase('POST file-system move B under A', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, { operation: 'move', folderId: fsFolderB, parentFolderId: fsFolderA })
	return r.status === 200 || r.status === 201
})

await testCase('POST file-system delete B', async () => {
	const r = await api('POST', `/groups/${gid}/file-system`, { operation: 'delete', folderId: fsFolderB })
	return r.status === 200 || r.status === 201
})

await testCase('POST chunks + register file (download-resume)', async () => {
	const data = Buffer.from('ext-download-resume-payload').toString('base64')
	const up = await api('POST', `/groups/${gid}/chunks`, { fileId: dlFileId, data, channelId: cid, ceMode: 'convergent' })
	if (up.status !== 200 && up.status !== 201) throw new Error(`chunk ${up.status}: ${up.raw}`)
	dlChunk = up.json
	const body = {
		fileId: dlFileId,
		name: 'resume.txt',
		size: 27,
		mimeType: 'text/plain',
		folderId: null,
		ceMode: dlChunk.ceMode,
		contentHash: dlChunk.contentHash,
		ciphertextHash: dlChunk.ciphertextHash,
		wrappedKey: dlChunk.wrappedKey,
		storageLocator: dlChunk.storageLocator,
		key_generation: dlChunk.key_generation,
		channelId: cid,
	}
	const reg = await api('POST', `/groups/${gid}/files`, body)
	if (reg.status !== 201) throw new Error(`register ${reg.status}: ${reg.raw}`)
	return Boolean(reg.json.event)
})

await testCase('POST files/:id/download-resume local complete', async () => {
	const r = await api('POST', `/groups/${gid}/files/${dlFileId}/download-resume`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const ok = await pollUntil(async () => {
		const ds = await api('GET', `/groups/${gid}/files/${dlFileId}/download-status`)
		return ds.status === 200 && (
			ds.json.status?.status === 'done' ||
			(ds.json.status?.total > 0 && ds.json.status?.done >= ds.json.status?.total)
		)
	}, 30)
	if (!ok) {
		const ds = await api('GET', `/groups/${gid}/files/${dlFileId}/download-status`)
		throw new Error(`download not complete: ${ds.raw}`)
	}
	return r.json.ok === true
})

await testCase('GET files/:id/download-status after resume', async () => {
	const r = await api('GET', `/groups/${gid}/files/${dlFileId}/download-status`)
	return r.status === 200 && (
		r.json.status?.status === 'done' ||
		(r.json.status?.total > 0 && r.json.status?.done >= r.json.status?.total)
	)
})

await testCase('DELETE /archive?before= (local prune)', async () => {
	const r = await api('DELETE', `/groups/${gid}/archive?before=2099-01`)
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return r.json != null
})

// ---------------------------------------------------------------------------
writeLiveSection('D. Stickers — full write path')
let packId = null
let stickerId = null
let stickerFile = null
let importStickerId = null

await testCase('POST /stickers/packs create', async () => {
	const r = await api('POST', '/stickers/packs', { name: 'E2E-ext-pack', description: 'ext', isPublic: true })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	packId = r.json.pack?.packId ?? r.json.pack?.id
	return Boolean(packId)
})

await testCase('GET /stickers/packs/:id', async () => {
	const r = await api('GET', `/stickers/packs/${packId}`)
	return r.status === 200 && r.json.pack?.packId === packId
})

await testCase('PUT /stickers/packs/:id', async () => {
	const r = await api('PUT', `/stickers/packs/${packId}`, { name: 'E2E-ext-pack-2', description: 'updated' })
	return r.status === 200 && r.json.pack?.name === 'E2E-ext-pack-2'
})

await testCase('POST /stickers/packs/:id/stickers upload', async () => {
	const r = await chatApiMultipart('POST', `/stickers/packs/${packId}/stickers`, { name: 'e2e-sticker' }, 'sticker', 'e2e.png', pngBytes)
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	stickerId = r.json.sticker?.id ?? r.json.sticker?.stickerId
	const stickerUrl = String(r.json.sticker?.url ?? '')
	const match = stickerUrl.match(/\/file\/([^/?]+)/)
	stickerFile = match?.[1] ?? r.json.sticker?.file
	return Boolean(stickerId)
})

await testCase('GET /stickers/packs/:id/file/:name', async () => {
	if (!stickerFile) throw new Error('sticker file name missing')
	const r = await api('GET', `/stickers/packs/${packId}/file/${stickerFile}`)
	return r.status === 200 && r.raw.length > 0
})

await testCase('POST /stickers/install/:packId', async () => {
	const r = await api('POST', `/stickers/install/${packId}`, {})
	return r.status === 200
})

await testCase('GET /stickers/collection installed', async () => {
	const r = await api('GET', '/stickers/collection')
	return r.status === 200 && r.json.collection?.installedPacks?.includes(packId)
})

await testCase('POST /stickers/favorites/:stickerId', async () => {
	const r = await api('POST', `/stickers/favorites/${stickerId}`, {})
	return r.status === 200
})

await testCase('DELETE /stickers/favorites/:stickerId', async () => {
	const r = await api('DELETE', `/stickers/favorites/${stickerId}`)
	return r.status === 200
})

await testCase('POST /stickers/import', async () => {
	const r = await api('POST', '/stickers/import', { dataUrl: pngDataUrl, name: 'imported-ext' })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	importStickerId = r.json.sticker?.id ?? r.json.sticker?.stickerId
	return Boolean(importStickerId)
})

await testCase('POST /stickers/recent/:stickerId', async () => {
	const sid = importStickerId || stickerId
	const r = await api('POST', `/stickers/recent/${sid}`, {})
	return r.status === 200
})

await testCase('DELETE /stickers/packs/:id/stickers/:stickerId', async () => {
	const r = await api('DELETE', `/stickers/packs/${packId}/stickers/${stickerId}`)
	return r.status === 200
})

await testCase('POST /stickers/uninstall/:packId', async () => {
	const r = await api('POST', `/stickers/uninstall/${packId}`, {})
	return r.status === 200
})

await testCase('DELETE /stickers/packs/:id', async () => {
	const r = await api('DELETE', `/stickers/packs/${packId}`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('E. Group emojis — write')
let gEmojiId = null

await testCase('POST /groups/:id/emojis', async () => {
	const r = await chatApiMultipart('POST', `/groups/${gid}/emojis`, { name: 'ext-emoji' }, 'emoji', 'emoji.png', pngBytes)
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	gEmojiId = r.json.entry?.emojiId
	return Boolean(gEmojiId)
})

await testCase('GET /groups/:id/emojis/:id/data (json)', async () => {
	const r = await api('GET', `/groups/${gid}/emojis/${gEmojiId}/data?json=1`)
	return r.status === 200 && String(r.json.dataUrl ?? '').startsWith('data:')
})

await testCase('POST /custom-emojis/save (from group emoji)', async () => {
	const r = await api('POST', '/custom-emojis/save', { groupId: gid, emojiId: gEmojiId, dataUrl: pngDataUrl })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.entry?.id)
})

await testCase('DELETE /groups/:id/emojis/:id', async () => {
	const r = await api('DELETE', `/groups/${gid}/emojis/${gEmojiId}`)
	return r.status === 200
})

// ---------------------------------------------------------------------------
writeLiveSection('F. Sessions & misc writes')
let importedGid = null
let copyGid = null
let pluginName = null
let pluginAddStatus = null

await testCase('GET /custom-emojis contains saved entry', async () => {
	const r = await api('GET', '/custom-emojis')
	return r.status === 200 && (r.json.entries?.filter(row => row.groupId === gid).length ?? 0) >= 1
})

await testCase('POST /groups/import', async () => {
	let exp = await api('GET', `/groups/${gid}/export`)
	if (exp.status !== 200) throw new Error(`export ${exp.status}: ${exp.raw}`)
	if (!exp.json.messages?.length) {
		await waitForCharMessageId(gid, cid, fbChar, 60)
		exp = await api('GET', `/groups/${gid}/export`)
	}
	if (!exp.json.messages?.length) throw new Error('export has no chatLog messages')
	const body = {
		chars: exp.json.chars,
		world: exp.json.world,
		persona: exp.json.persona,
		plugins: exp.json.plugins,
		frequency: exp.json.frequency,
		messages: exp.json.messages,
	}
	const r = await api('POST', '/groups/import', body)
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	importedGid = r.json.groupId
	if (importedGid) createdGroups.push(importedGid)
	return Boolean(importedGid)
})

await testCase('POST /groups/:id/copy', async () => {
	const r = await api('POST', `/groups/${gid}/copy`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	copyGid = r.json.newGroupId
	if (copyGid) createdGroups.push(copyGid)
	return Boolean(copyGid)
})

await testCase('DELETE /sessions/:groupId', async () => {
	if (!importedGid) throw new Error('import group missing')
	const r = await api('DELETE', `/sessions/${importedGid}`)
	return r.status === 200
})

await testCase('PUT /groups/:id/world', async () => {
	const r = await api('PUT', `/groups/${gid}/world`, { worldname: 'test_world', channelId: cid })
	return r.status === 200
})

await testCase('PUT /groups/:id/persona', async () => {
	const r = await api('PUT', `/groups/${gid}/persona`, { personaname: 'test_persona' })
	return r.status === 200
})

for (const pn of ['timer', 'file-operations', 'fount-api']) {
	const pr = await api('POST', `/groups/${gid}/plugin`, { pluginname: pn })
	if (pr.status === 200) {
		pluginName = pn
		pluginAddStatus = pr.status
		break
	}
}
if (!pluginName) throw new Error('no installable plugin (timer/file-operations/fount-api)')

await testCase(`POST /groups/:id/plugin (${pluginName})`, async () => pluginAddStatus === 200)

await testCase('DELETE /groups/:id/plugin/:name', async () => {
	const r = await api('DELETE', `/groups/${gid}/plugin/${pluginName}`)
	return r.status === 200
})

await testCase('POST /groups/leave (copy group)', async () => {
	if (!copyGid) throw new Error('copy group missing')
	const r = await api('POST', '/groups/leave', { groupIds: [copyGid] })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const lists = await api('GET', '/sessions/list')
	return lists.json?.filter(row => row.groupId === copyGid).length === 0
})

// ---------------------------------------------------------------------------
writeLiveSection('G. Streaming')
let streamChId = null

await testCase('POST streaming channel', async () => {
	const r = await api('POST', `/groups/${gid}/channels`, { name: 'ext-stream', type: 'streaming', description: 'sfu/webrtc' })
	if (r.status !== 201) throw new Error(`status ${r.status}: ${r.raw}`)
	streamChId = r.json.channelId
	return Boolean(streamChId)
})

await testCase('POST /channels/:id/streaming-auth', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${streamChId}/streaming-auth`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return r.json.mode === 'webrtc' || r.json.mode === 'sfu'
})

await testCase('GET /channels/:id/streaming-view (unconfigured SFU → 404)', async () => {
	const r = await api('GET', `/groups/${gid}/channels/${streamChId}/streaming-view`)
	return r.status === 404 && /SFU|not configured/.test(String(r.raw))
})

// ---------------------------------------------------------------------------
writeLiveSection('B. Governance — ban / unban / owner-succession / fork')
const agentChar = await requireTestChar(gid)
let agentKey = null

await testCase(`agent member via POST char (${agentChar})`, async () => {
	const s = await api('GET', `/groups/${gid}/state`)
	const row = s.json.meta?.members?.find(m => m.charname === agentChar)
	if (!row) throw new Error('agent member row missing')
	agentKey = row.memberKey
	return Boolean(agentKey)
})

await testCase('POST members/:key/ban (entity scope)', async () => {
	const r = await api('POST', `/groups/${gid}/members/${encodeURIComponent(agentKey)}/ban`, { banScope: 'entity' })
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const s = await api('GET', `/groups/${gid}/state`)
	return s.json.meta?.members?.filter(m => m.memberKey === agentKey).length === 0
})

await testCase('ban blocks agent trigger-reply', async () => {
	const r = await api('POST', `/groups/${gid}/channels/${cid}/trigger-reply`, { charname: agentChar })
	return r.status !== 200
})

await testCase('POST members/:key/unban restores agent active', async () => {
	const r = await api('POST', `/groups/${gid}/members/${encodeURIComponent(agentKey)}/unban`, {})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	const ok = await pollUntil(async () => {
		const s = await api('GET', `/groups/${gid}/state`)
		return (s.json.meta?.members?.filter(m => m.memberKey === agentKey).length ?? 0) >= 1
	}, 20)
	if (!ok) throw new Error('agent not active after unban')
	return true
})

await testCase('POST members/:key/kick removes agent member (owner may kick own agent)', async () => {
	const r = await api('POST', `/groups/${gid}/members/${encodeURIComponent(agentKey)}/kick`, {})
	if (r.status !== 200) throw new Error(`kick ${r.status}: ${r.raw}`)
	const s = await api('GET', `/groups/${gid}/state`)
	return s.json.meta?.members?.filter(m => m.memberKey === agentKey).length === 0
})

await testCase('POST owner-succession rejects agent target (400)', async () => {
	const og = await api('POST', '/groups/', { name: 'E2E-ext-os', description: 'owner succession probe' })
	if (og.status !== 201) throw new Error(`create ${og.status}: ${og.raw}`)
	const ogid = og.json.groupId
	createdGroups.push(ogid)
	try {
		const ac = await api('POST', `/groups/${ogid}/char`, { charname: agentChar, deferGreeting: true })
		if (!okStatus(ac.status)) throw new Error(`char add ${ac.status}`)
		const s0 = await api('GET', `/groups/${ogid}/state`)
		const agentRow = s0.json.meta?.members?.find(m => m.charname === agentChar)
		if (!agentRow?.memberKey) throw new Error('agent memberKey missing')
		const ballotId = `e2e-ext-os-${randomUUID().replace(/-/g, '').slice(0, 12)}`
		const r = await api('POST', `/groups/${ogid}/owner-succession`, {
			proposedOwnerPubKeyHash: agentRow.memberKey,
			ballotId,
		})
		if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.raw}`)
		const s1 = await api('GET', `/groups/${ogid}/state`)
		return !s1.json.meta?.delegatedOwnerPubKeyHash
	}
	finally {
		await api('POST', '/groups/leave', { groupIds: [ogid] })
	}
})

await testCase('POST fork/block-opposing with current tip (HTTP smoke)', async () => {
	const fg = await api('POST', '/groups/', { name: 'E2E-ext-fork', description: 'fork smoke probe' })
	if (fg.status !== 201) throw new Error(`create ${fg.status}: ${fg.raw}`)
	const fgid = fg.json.groupId
	createdGroups.push(fgid)
	try {
		const tips = await api('GET', `/groups/${fgid}/dag/tips`)
		if (tips.status !== 200) throw new Error(`tips ${tips.status}`)
		const tip = tips.json.tips?.[0]
		if (!tip) throw new Error('no dag tip')
		const r = await api('POST', `/groups/${fgid}/fork/block-opposing`, { acceptedTipId: tip })
		return r.status === 200 && r.json != null
	}
	finally {
		await api('POST', '/groups/leave', { groupIds: [fgid] })
	}
})

// ---------------------------------------------------------------------------
writeLiveSection('Cleanup')
for (const g of [...new Set(createdGroups)]) {
	const r = await api('DELETE', `/groups/${g}`)
	if (r.status === 200) console.log(`  deleted ${g}`)
	else if (r.status === 403 || r.status === 404) {
		await api('POST', '/groups/leave', { groupIds: [g] })
		console.log(`  released ${g} (status ${r.status})`)
	}
	else console.log(`  cleanup WARN ${g} status ${r.status}`)
}

writeLiveSummary('chat e2e_single_ext')
completeLiveScript()
