/**
 * 文件柜 HTTP：柜 CRUD、条目、密码文件夹、链接。
 */
/* global Deno */
import { launchNode, pickAvailablePort, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'


Deno.test({
	name: 'cabinet personal CRUD + password folder + link',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const port = await pickAvailablePort(29131)
	const apiKey = `fount-cabinet-${Date.now().toString(36)}`
	const node = await launchNode({
		port,
		username: 'cabinet-http-user',
		apiKey,
		loadParts: ['shells/chat', 'shells/social', 'shells/cabinet'],
		p2p: false,
		minP2pNode: true,
	})
	const { baseUrl } = node
	const q = `fount-apikey=${encodeURIComponent(apiKey)}`
	try {
		const listRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`)
		const listRaw = await listRes.text()
		assertEquals(listRes.status, 200, listRaw)
		const list = JSON.parse(listRaw)
		assert(list.cabinets.some(row => row.cabinet_id === 'default'))

		const createRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'Docs',
				visibility: { visibility: 'private' },
			}),
		})
		const createRaw = await createRes.text()
		assertEquals(createRes.status, 200, createRaw)
		const { cabinet } = JSON.parse(createRaw)
		assert(cabinet.cabinet_id)

		const folderRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/entries?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: 'folder', name: 'secret' }),
		})
		const folderRaw = await folderRes.text()
		assertEquals(folderRes.status, 200, folderRaw)
		const folder = JSON.parse(folderRaw).entry

		const lockRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/entries/${folder.id}?${q}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ set_password: 'hunter2', description: 'vault folder' }),
		})
		assertEquals(lockRes.status, 200, await lockRes.text())

		const lockedList = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/index?parent_id=${folder.id}&${q}`)
		const lockedBody = await lockedList.json()
		assertEquals(lockedBody.locked, true)
		assertEquals(lockedBody.folder_trail, [{ id: folder.id, name: 'secret' }])

		const unlockRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/unlock?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folder_id: folder.id, password: 'hunter2' }),
		})
		const unlockRaw = await unlockRes.text()
		assertEquals(unlockRes.status, 200, unlockRaw)
		const { unlock_token } = JSON.parse(unlockRaw)
		assert(unlock_token)

		const uploadRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/entries?${q}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-Cabinet-Unlock': unlock_token,
			},
			body: JSON.stringify({
				plaintext_base64: btoa('hello cabinet'),
				name: 'note.txt',
				mime_type: 'text/plain',
				parent_id: folder.id,
				description: 'a note',
			}),
		})
		const uploadRaw = await uploadRes.text()
		assertEquals(uploadRes.status, 200, uploadRaw)
		const fileEntry = JSON.parse(uploadRaw).entry
		assertEquals(fileEntry.mime_type, 'text/plain')
		assertEquals(fileEntry.description, 'a note')

		const linkRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/entries/copy?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				entry_ids: [folder.id],
				target_parent_id: null,
				as_links: true,
			}),
		})
		assertEquals(linkRes.status, 200, await linkRes.text())

		const root = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${cabinet.cabinet_id}/index?${q}`)
		const rootBody = await root.json()
		assert(rootBody.entries.some(row => row.kind === 'link'))

		const sharedCreate = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'shared', name: 'SharedDocs' }),
		})
		const sharedCreateRaw = await sharedCreate.text()
		assertEquals(sharedCreate.status, 200, sharedCreateRaw)
		const sharedId = JSON.parse(sharedCreateRaw).cabinet?.cabinet_id
		assert(sharedId && /^[0-9a-f]{64}$/.test(sharedId))

		const sharedUpload = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${sharedId}/entries?${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				plaintext_base64: btoa('shared hello'),
				name: 'shared.txt',
				mime_type: 'text/plain',
			}),
		})
		const sharedUploadRaw = await sharedUpload.text()
		assertEquals(sharedUpload.status, 200, sharedUploadRaw)
		const sharedEntry = JSON.parse(sharedUploadRaw).entry
		assert(sharedEntry?.id)

		const sharedIndex = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${sharedId}/index?${q}`)
		const sharedIndexBody = await sharedIndex.json()
		assert(sharedIndexBody.entries.some(row => row.id === sharedEntry.id))

		const sharedDl = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${sharedId}/entries/${sharedEntry.id}/download?${q}`)
		const sharedDlRaw = await sharedDl.text()
		assertEquals(sharedDl.status, 200, sharedDlRaw)
		assertEquals(sharedDlRaw, 'shared hello')
	}
	finally {
		await stopNode(node)
	}
})
