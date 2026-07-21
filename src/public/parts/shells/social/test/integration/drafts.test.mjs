/**
 * 草稿箱 CRUD 集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

Deno.test('composer drafts upsert list get delete', async () => {
	const { username } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username)

	const created = await client.drafts.upsert({ text: 'draft-hello', visibility: 'public' })
	assert(created.draftId)
	assertEquals(created.preview, 'draft-hello')
	assertEquals(created.body.text, 'draft-hello')

	const listed = await client.drafts.list()
	assert(listed.drafts.some(row => row.draftId === created.draftId))

	const updated = await client.drafts.upsert({
		draftId: created.draftId,
		text: 'draft-updated',
		visibility: 'followers',
	})
	assertEquals(updated.draftId, created.draftId)
	assertEquals(updated.body.text, 'draft-updated')
	assertEquals(updated.body.visibility, 'followers')

	const got = await client.drafts.get(created.draftId)
	assertEquals(got.body.text, 'draft-updated')

	const afterDelete = await client.drafts.delete(created.draftId)
	assert(!afterDelete.drafts.some(row => row.draftId === created.draftId))
})
