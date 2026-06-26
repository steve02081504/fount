/**
 * dag/storage.mjs ENOENT 容错：cleanup 竞态下群目录已被删除，后台读流不应抛 unhandled error。
 */
/* global Deno */
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { readJsonl, readJsonlStream } from '../dag/storage.mjs'

Deno.test('readJsonl returns [] for missing file', async () => {
	const missing = join(Deno.makeTempDirSync(), 'nope.jsonl')
	assertEquals(await readJsonl(missing), [])
})

Deno.test('readJsonlStream silently yields nothing for missing file (no unhandled error)', async () => {
	const missing = join(Deno.makeTempDirSync(), 'gone.jsonl')
	const rows = []
	for await (const row of readJsonlStream(missing)) rows.push(row)
	assertEquals(rows, [])
})

Deno.test('readJsonlStream survives cleanup race: file deleted mid-iteration', async () => {
	const dir = Deno.makeTempDirSync()
	const path = join(dir, 'events.jsonl')
	Deno.writeTextFileSync(path, `${JSON.stringify({ id: 'a' })}\n${JSON.stringify({ id: 'b' })}\n`)
	const ids = []
	for await (const row of readJsonlStream(path)) ids.push(row.id)
	assertEquals(ids.sort(), ['a', 'b'])
	// 删除文件后再次迭代：应静默返回空，不抛 ENOENT。
	Deno.removeSync(path)
	const after = []
	for await (const row of readJsonlStream(path)) after.push(row)
	assertEquals(after, [])
})
