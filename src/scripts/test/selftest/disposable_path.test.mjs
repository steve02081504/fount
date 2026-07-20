/**
 * assertDisposableDataPath 护栏：仅 tmpdir / data/test 可被破坏性清理。
 */
/* global Deno */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { assertDisposableDataPath } from '../core/disposable_path.mjs'
import { testDataRoot } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

Deno.test('assertDisposableDataPath allows tmpdir children', () => {
	assertDisposableDataPath(mkdtempSync(join(tmpdir(), 'fount_dispose_ok_')))
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
