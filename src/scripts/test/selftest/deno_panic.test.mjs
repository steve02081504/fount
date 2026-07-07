/* global Deno */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { parseDenoPanic, readPanicRecord } from '../core/deno_panic.mjs'
import { denoPanicRecordPath } from '../core/paths.mjs'

// 用拼接构造横幅，避免源文件里出现可被误扫的连续字面量。
const MARKER = ['Deno has', 'panicked. This is a bug in Deno.'].join(' ')

const SAMPLE = [
	'running 1 test from ./src/scripts/p2p/test/live/backpressure_smoke.test.mjs',
	'============================================================',
	MARKER,
	'Please report this at https://github.com/denoland/deno/issues/new.',
	'',
	'Platform: windows x86_64',
	'Version: 2.9.1',
	'Args: ["E:\\\\deno.EXE", "test", "--allow-all"]',
	'',
	'View stack trace at:',
	'https://panic.deno.com/v2.9.1/x86_64-pc-windows-msvc/abc123',
	'',
	"thread 'tokio-runtime-worker' (69808) panicked at C:\\Users\\runneradmin\\.cargo\\registry\\v8-149.4.0\\src\\handle.rs:628:9:",
	'attempt to access Handle hosted by disposed Isolate',
	'stack backtrace:',
].join('\n')

Deno.test('parseDenoPanic returns null without the panic banner', () => {
	assertEquals(parseDenoPanic('ok (1s)\nall passed'), null)
	assertEquals(parseDenoPanic(''), null)
})

Deno.test('parseDenoPanic extracts location, version and message', () => {
	const panic = parseDenoPanic(SAMPLE)
	assertEquals(panic.file, 'C:\\Users\\runneradmin\\.cargo\\registry\\v8-149.4.0\\src\\handle.rs')
	assertEquals(panic.line, 628)
	assertEquals(panic.col, 9)
	assertEquals(panic.signature, 'C:\\Users\\runneradmin\\.cargo\\registry\\v8-149.4.0\\src\\handle.rs:628:9')
	assertEquals(panic.message, 'attempt to access Handle hosted by disposed Isolate')
	assertEquals(panic.version, '2.9.1')
	assertEquals(panic.platform, 'windows x86_64')
	assertEquals(panic.stackUrl, 'https://panic.deno.com/v2.9.1/x86_64-pc-windows-msvc/abc123')
})

Deno.test('readPanicRecord clears records on Deno version drift', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-panic-rec-'))
	await mkdir(join(repoRoot, 'data', 'test'), { recursive: true })
	await writeFile(denoPanicRecordPath(repoRoot), JSON.stringify({
		version: '2.9.0',
		panics: { 'x:1:1': { reported: true } },
	}), 'utf8')

	const same = await readPanicRecord(repoRoot, '2.9.0')
	assertEquals(same.panics['x:1:1'].reported, true)

	const drifted = await readPanicRecord(repoRoot, '2.9.1')
	assertEquals(drifted.version, '2.9.1')
	assertEquals(drifted.panics, {})
})

Deno.test('readPanicRecord returns empty record when file is missing', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-panic-rec-'))
	const record = await readPanicRecord(repoRoot, '2.9.1')
	assertEquals(record, { version: '2.9.1', panics: {} })
})
