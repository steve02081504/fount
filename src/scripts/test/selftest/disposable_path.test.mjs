/**
 * assertDisposableDataPath 护栏：仅 tmpdir / data/test 可被破坏性清理；
 * 以及回收清单（data_registry）只删登记目录、跳过拒绝路径、并删掉清单本身。
 */
/* global Deno */
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertThrows } from 'jsr:@std/assert'

import { allocateDataDirRegistryPath, reclaimDataDirs } from '../core/data_registry.mjs'
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

Deno.test('reclaimDataDirs 删除登记的数据目录与清单本身', async () => {
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_registry_reap_'))
	const registryPath = allocateDataDirRegistryPath('fount_registry_test')
	try {
		writeFileSync(registryPath, `${dataDir}\n\n`, 'utf8')
		await reclaimDataDirs(registryPath)
		assert(!existsSync(dataDir))
		assert(!existsSync(registryPath))
	}
	finally {
		rmSync(dataDir, { recursive: true, force: true })
		rmSync(registryPath, { force: true })
	}
})

Deno.test('reclaimDataDirs 跳过非可清理路径，不误删也不抛错', async () => {
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_registry_keep_'))
	const registryPath = allocateDataDirRegistryPath('fount_registry_test')
	try {
		appendFileSync(registryPath, `${join(REPO_ROOT, 'src')}\n${dataDir}\n`, 'utf8')
		await reclaimDataDirs(registryPath)
		assert(existsSync(dataDir))
		assert(!existsSync(registryPath))
	}
	finally {
		rmSync(dataDir, { recursive: true, force: true })
		rmSync(registryPath, { force: true })
	}
})

Deno.test('reclaimDataDirs 对缺失清单与空路径静默返回', async () => {
	await reclaimDataDirs(allocateDataDirRegistryPath('fount_registry_absent'))
	await reclaimDataDirs('')
})
