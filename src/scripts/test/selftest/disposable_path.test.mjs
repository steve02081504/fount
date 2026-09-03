/**
 * assertDisposableDataPath 护栏：仅 tmpdir / data/test 可被破坏性清理。
 */
/* global Deno */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertThrows } from 'jsr:@std/assert'

import { assertDisposableDataPath } from '../core/disposable_path.mjs'
import { testDataRoot } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

Deno.test('assertDisposableDataPath allows tmpdir children', () => {
	// scratch 也要按 fount 前缀建（保持 cleanup_check 的泄漏覆盖），用后立即清理。
	const dir = mkdtempSync(join(tmpdir(), 'fount_dispose_ok_'))
	try {
		assertDisposableDataPath(dir)
	}
	finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

Deno.test('assertDisposableDataPath allows data/test children', () => {
	assertDisposableDataPath(join(testDataRoot(REPO_ROOT), 'scratch_guard'))
})

Deno.test('assertDisposableDataPath rejects repo real data root', () => {
	assertThrows(
		() => assertDisposableDataPath(join(REPO_ROOT, 'data')),
		Error,
		'refusing destructive test I/O',
	)
})

Deno.test('assertDisposableDataPath rejects arbitrary absolute path', () => {
	assertThrows(
		() => assertDisposableDataPath(join(REPO_ROOT, 'src')),
		Error,
		'refusing destructive test I/O',
	)
})
