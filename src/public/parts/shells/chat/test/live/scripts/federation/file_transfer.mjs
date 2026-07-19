import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
	Api,
	ClearFedGroup,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	pollUntil,
	testCase,
} from 'fount/scripts/test/live/federation/common.mjs'

const fileId = randomUUID()

console.log('=== Setup: open group + join ===')
const setup = await InitializeOpenGroupJoin('FedFileXfer', 'file-xfer-seed')
const gid = setup.groupId
const cid = setup.channelId

console.log('\n=== A uploads chunk + registers file ===')
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

console.log('\n=== B federation file sync ===')
await testCase('B sees file meta (DAG sync)', async () => pollUntil(async () => {
	const m = await Api(FedB, 'GET', `/groups/${gid}/files/${fileId}/meta`)
	return m.status === 200 && m.json.fileId === fileId
}, 60, 3))

await testCase('B downloads file content via federation', async () => {
	const rs = await Api(FedB, 'POST', `/groups/${gid}/files/${fileId}/download-resume`, {})
	if (rs.status !== 200) throw new Error(`resume ${rs.status}: ${rs.raw}`)
	const done = await pollUntil(async () => {
		const st = await Api(FedB, 'GET', `/groups/${gid}/files/${fileId}/download-status`)
		if (st.status !== 200) return false
		const s = st.json.status
		if (s?.status === 'failed' || s?.error) throw new Error(`download failed: ${st.raw}`)
		return s?.status === 'done' || s?.percent === 100 || (s?.done >= s?.total && s?.total > 0)
	}, 150, 4)
	return Boolean(done)
})

await ClearFedGroup(gid)
console.log('\n=== DONE fed_file_transfer ===')
