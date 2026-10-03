/* global Deno */
/** 测试附件的持久性、去重、可达性与保留策略。 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'
import { getUserDictionary } from 'fount/server/auth/index.mjs'

import { snapshotAttachment, storeAttachments, sweepAttachments } from '../../src/attachments.mjs'
import { clearGenerations, getAttachment, getGeneration, pruneGenerations, recordGeneration } from '../../src/generation_history.mjs'

Deno.test('shared attachments survive prompt expiry and filtered clearing until their last root disappears', async () => {
	await bootHeadlessDataRoot()
	const username = `studio-attachments-${crypto.randomUUID()}`
	const root = path.join(os.tmpdir(), 'fount', 'agent_studio', username)
	const files = [{ name: 'notes.txt', mime_type: 'text/plain', buffer: Buffer.from('shared bytes') }]
	const now = Date.now()
	/**
	 * @param {string} id Generation.
	 * @param {number} finishedAt Time.
	 * @returns {object} Record.
	 */
	const record = (id, finishedAt = now) => ({
		id, charId: id, source: 'test', startedAt: finishedAt, finishedAt,
		requests: [{ index: 1, messages: [{ id: 'm1', role: 'user', content: '', files }] }],
		dialogue: { rounds: 1, events: [{ round: 1, op: 'insert', message: { id: 'm1', role: 'user', content: '', files } }] },
	})
	try {
		const first = await recordGeneration(username, record('first', now - 3 * 86400000))
		const second = record('second')
		second.requests[0].messages[0].files = files.map(file => ({ ...file, name: 'renamed.txt' }))
		await recordGeneration(username, second)
		const hash = first.requests[0].messages[0].files[0].hash
		assertEquals(fs.readdirSync(path.join(root, 'attachments')), [hash])
		assertEquals(getAttachment(username, hash, 'renamed.txt').file.name, 'renamed.txt')
		assertEquals(getAttachment(username, hash, 'missing.txt'), null)
		assertEquals(first.requests[0].messages[0].files[0].buffer, undefined)
		assertEquals(fs.existsSync(path.join(getUserDictionary(username), 'shells', 'agent_studio')), false)
		assert(!fs.readFileSync(path.join(root, 'records', 'second.json'), 'utf8').includes('"buffer"'))
		pruneGenerations(username)
		assertEquals((await getGeneration(username, 'first')).requests, undefined)
		assert(getAttachment(username, hash)) // retained dialogue is still a GC root
		await clearGenerations(username, { charId: 'second' })
		assert(getAttachment(username, hash))
		assertEquals(getAttachment(`${username}-other`, hash), null)
		assertEquals(getAttachment(username, '../index.json'), null)
		await clearGenerations(username)
		assertEquals(fs.readdirSync(path.join(root, 'attachments')), [])
		await recordGeneration(username, record('expired', now - 8 * 86400000))
		assertEquals(await getGeneration(username, 'expired'), null)
		assertEquals(fs.readdirSync(path.join(root, 'attachments')), [])
		const promptOnly = record('prompt-only', now - 3 * 86400000)
		delete promptOnly.dialogue
		await recordGeneration(username, promptOnly)
		pruneGenerations(username)
		assertEquals(fs.readdirSync(path.join(root, 'attachments')), [])
		await recordGeneration(username, record('replacement'))
		const replacement = record('replacement')
		replacement.requests[0].messages[0].files = [{ name: 'new.txt', buffer: Buffer.from('new bytes') }]
		replacement.dialogue.events = []
		const replaced = await recordGeneration(username, replacement)
		assertEquals(fs.readdirSync(path.join(root, 'attachments')), [replaced.requests[0].messages[0].files[0].hash])
		assertEquals(getAttachment(username, hash), null)
	}
	finally {
		fs.rmSync(root, { recursive: true, force: true })
		fs.rmSync(`${root}-other`, { recursive: true, force: true })
	}
})

Deno.test('attachment snapshots copy bytes, dedupe encodings, and abort GC on corrupt roots', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-attachments-'))
	try {
		const bytes = Buffer.from('hello')
		const first = snapshotAttachment({ name: 'first', buffer: bytes })
		bytes.fill(0)
		assertEquals(first.buffer.toString(), 'hello')
		const blobs = path.join(root, 'attachments')
		const stored = storeAttachments(blobs, { files: [first, { name: 'second', buffer: Buffer.from('hello').toString('base64') }] })
		assertEquals(stored.files[0].hash, stored.files[1].hash)
		assertEquals(fs.readdirSync(blobs).length, 1)
		const record = path.join(root, 'record.json')
		fs.writeFileSync(record, JSON.stringify(stored))
		assertEquals(sweepAttachments(blobs, [record]), 0)
		fs.writeFileSync(record, '{broken')
		assertEquals(sweepAttachments(blobs, [record]), 0)
		assertEquals(fs.readdirSync(blobs).length, 1)
		assertEquals(sweepAttachments(blobs, []), 1)
	}
	finally { fs.rmSync(root, { recursive: true, force: true }) }
})
