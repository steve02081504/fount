/* global Deno */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	fitGhIssueTitle,
	GH_ISSUE_TITLE_MAX,
	isDenoTeardownCrashAfterGreenTests,
	parseDenoPanic,
	readPanicRecord,
} from '../core/deno_panic.mjs'
import { denoPanicRecordPath } from '../core/paths.mjs'
import { childEnv } from '../env.mjs'

// 用拼接构造横幅，避免源文件里出现可被误扫的连续字面量。
const MARKER = ['Deno has', 'panicked. This is a bug in Deno.'].join(' ')

const SAMPLE = [
	'running 1 test from ./src/public/parts/shells/chat/test/live/scripts/ws_stream.test.mjs',
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
	'thread \'tokio-runtime-worker\' (69808) panicked at C:\\Users\\runneradmin\\.cargo\\registry\\v8-149.4.0\\src\\handle.rs:628:9:',
	'attempt to access Handle hosted by disposed Isolate',
	'stack backtrace:',
].join('\n')

const MULTILINE_SAMPLE = [
	'ok | 6 passed | 0 failed (16ms)',
	'',
	'============================================================',
	MARKER,
	'',
	'Platform: windows x86_64',
	'Version: 2.9.2+c537e01',
	'',
	'thread \'tokio-runtime-worker\' (52400) panicked at ext\\napi\\node_api.rs:947:5:',
	'assertion failed: self.is_closed.compare_exchange(false, true, Ordering::Relaxed,',
	'        Ordering::Relaxed).is_ok()',
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

Deno.test('parseDenoPanic folds multiline assertion until stack backtrace', () => {
	const panic = parseDenoPanic(MULTILINE_SAMPLE)
	assertEquals(panic.file, 'ext\\napi\\node_api.rs')
	assertEquals(panic.line, 947)
	assertEquals(panic.col, 5)
	assertEquals(
		panic.message,
		'assertion failed: self.is_closed.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_ok()',
	)
	assertEquals(panic.version, '2.9.2+c537e01')
})

Deno.test('fitGhIssueTitle keeps short titles unchanged', () => {
	const title = fitGhIssueTitle('attempt to access Handle hosted by disposed Isolate', '2.9.1')
	assertEquals(title, '[fount auto-report] Deno panic: attempt to access Handle hosted by disposed Isolate (2.9.1)')
})

Deno.test('fitGhIssueTitle shrinks parentheses inside summary first', () => {
	const summary = `assertion failed: self.is_closed.compare_exchange(${'false, true, Ordering::Relaxed, Ordering::Relaxed'.repeat(8)}).is_ok()`
	const version = '2.9.2+c537e01'
	const raw = `[fount auto-report] Deno panic: ${summary} (${version})`
	assertEquals([...raw].length > GH_ISSUE_TITLE_MAX, true)

	const title = fitGhIssueTitle(summary, version)
	assertEquals([...title].length <= GH_ISSUE_TITLE_MAX, true)
	assertEquals(title.endsWith(` (${version})`), true)
	assertEquals(title.includes('(…)'), true)
	assertEquals(title.includes('false, true'), false)
})

Deno.test('fitGhIssueTitle truncates summary when parentheses shrink is not enough', () => {
	const version = '2.9.2+c537e01'
	const summary = 'x'.repeat(300)
	const title = fitGhIssueTitle(summary, version)

	assertEquals([...title].length, GH_ISSUE_TITLE_MAX)
	assertEquals(title.endsWith(` (${version})`), true)
	assertEquals(title.includes('…'), true)
})

Deno.test('childEnv forces RUST_BACKTRACE=full over external value', () => {
	const prev = process.env.RUST_BACKTRACE
	process.env.RUST_BACKTRACE = '1'
	try {
		assertEquals(childEnv().RUST_BACKTRACE, 'full')
		assertEquals(childEnv({ FOUNT_TEST: '1' }).RUST_BACKTRACE, 'full')
	}
	finally {
		if (prev === undefined) delete process.env.RUST_BACKTRACE
		else process.env.RUST_BACKTRACE = prev
	}
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

Deno.test('isDenoTeardownCrashAfterGreenTests treats Windows exit without summary as pass when no FAILED', () => {
	const output = [
		'running 15 tests from ./federation_rpc.test.mjs',
		'handleSocialRpc: unknown rpc type returns null ... ok (1s)',
		'follow then seeded remote post is pullable via federation RPC ... ok (133ms)',
	].join('\n')
	assertEquals(isDenoTeardownCrashAfterGreenTests(-1073740940, output), true)
	assertEquals(isDenoTeardownCrashAfterGreenTests(-1073741819, output), true)
	assertEquals(isDenoTeardownCrashAfterGreenTests(-1073740940, `${output}\nsomething ... FAILED (1ms)`), false)
})

Deno.test('isDenoTeardownCrashAfterGreenTests treats Deno panic after green summary as pass', () => {
	assertEquals(isDenoTeardownCrashAfterGreenTests(1, MULTILINE_SAMPLE), true)
})

Deno.test('isDenoTeardownCrashAfterGreenTests treats Linux SIGSEGV after green summary as pass', () => {
	const output = 'ok | 15 passed | 0 failed (24s)\n'
	assertEquals(isDenoTeardownCrashAfterGreenTests(1, output, 'SIGSEGV'), true)
	assertEquals(isDenoTeardownCrashAfterGreenTests(1, output, 'SIGABRT'), true)
	assertEquals(isDenoTeardownCrashAfterGreenTests(1, output, 'SIGTERM'), false)
	assertEquals(isDenoTeardownCrashAfterGreenTests(1, 'ok | 14 passed | 1 failed (1s)\n', 'SIGSEGV'), false)
})

Deno.test('readPanicRecord returns empty record when file is missing', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-panic-rec-'))
	const record = await readPanicRecord(repoRoot, '2.9.1')
	assertEquals(record, { version: '2.9.1', panics: {} })
})
