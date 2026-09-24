/**
 * 内核侧 Deno 更新：pin 解析、跳过开关、新鲜标记短路。
 */
/* global Deno */
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assertEquals } from 'jsr:@std/assert'

import { acquireLock, clearStaleLock, maybeUpgradeDeno, resolveDenoUpgradeSpec, STALE_LOCK_MS } from '../kernel/deno_update.mjs'

/**
 * 建一个临时 repo 根。
 * @param {string | null} pin `.deno-version` 内容（null 表示不写）
 * @returns {string} 路径
 */
function tempRepo(pin) {
	const dir = mkdtempSync(join(tmpdir(), 'fount-deno-update-'))
	if (pin != null) writeFileSync(join(dir, '.deno-version'), `${pin}\n`, 'utf8')
	return dir
}

Deno.test('resolveDenoUpgradeSpec: pr pin becomes ["pr", N]', () => {
	const dir = tempRepo('pr 36606')
	try {
		assertEquals(resolveDenoUpgradeSpec(dir), { spec: ['pr', '36606'], label: 'pr 36606' })
	}
	finally { rmSync(dir, { recursive: true, force: true }) }
})

Deno.test('resolveDenoUpgradeSpec: channel / semver pin passes through', () => {
	const channel = tempRepo('canary')
	const semver = tempRepo('2.9.5')
	try {
		assertEquals(resolveDenoUpgradeSpec(channel), { spec: ['canary'], label: 'canary' })
		assertEquals(resolveDenoUpgradeSpec(semver), { spec: ['2.9.5'], label: '2.9.5' })
	}
	finally {
		rmSync(channel, { recursive: true, force: true })
		rmSync(semver, { recursive: true, force: true })
	}
})

Deno.test('resolveDenoUpgradeSpec: missing or empty pin falls back to canary', () => {
	const missing = tempRepo(null)
	const empty = tempRepo('')
	try {
		assertEquals(resolveDenoUpgradeSpec(missing), { spec: ['canary'], label: 'canary' })
		assertEquals(resolveDenoUpgradeSpec(empty), { spec: ['canary'], label: 'canary' })
	}
	finally {
		rmSync(missing, { recursive: true, force: true })
		rmSync(empty, { recursive: true, force: true })
	}
})

Deno.test('maybeUpgradeDeno: FOUNT_TEST_SKIP_DENO_UPGRADE short-circuits', async () => {
	const dir = tempRepo('canary')
	const previous = process.env.FOUNT_TEST_SKIP_DENO_UPGRADE
	process.env.FOUNT_TEST_SKIP_DENO_UPGRADE = '1'
	try {
		assertEquals(await maybeUpgradeDeno({ repoRoot: dir, reason: 'test' }), { status: 'skipped', changed: false })
	}
	finally {
		if (previous === undefined) delete process.env.FOUNT_TEST_SKIP_DENO_UPGRADE
		else process.env.FOUNT_TEST_SKIP_DENO_UPGRADE = previous
		rmSync(dir, { recursive: true, force: true })
	}
})

Deno.test('maybeUpgradeDeno: fresh marker short-circuits without running deno upgrade', async () => {
	const dir = tempRepo('canary')
	mkdirSync(join(dir, 'data/installer'), { recursive: true })
	writeFileSync(join(dir, 'data/installer/deno_upgraded.test'), JSON.stringify({ channel: 'canary', at: Date.now() }), 'utf8')
	// 环境可能被外层 runner 设了 skip（那会先短路成 skipped），本用例只验证标记短路，先摘掉。
	const previous = process.env.FOUNT_TEST_SKIP_DENO_UPGRADE
	delete process.env.FOUNT_TEST_SKIP_DENO_UPGRADE
	try {
		const result = await maybeUpgradeDeno({ repoRoot: dir, reason: 'test', intervalMs: 60_000 })
		assertEquals(result.status, 'fresh')
		assertEquals(result.changed, false)
	}
	finally {
		if (previous !== undefined) process.env.FOUNT_TEST_SKIP_DENO_UPGRADE = previous
		rmSync(dir, { recursive: true, force: true })
	}
})

Deno.test('clearStaleLock: clears only locks older than STALE_LOCK_MS', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fount-deno-lock-'))
	const lockPath = join(dir, 'deno-update.lock')
	try {
		writeFileSync(lockPath, '', 'utf8')
		const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
		utimesSync(lockPath, old, old)
		assertEquals(clearStaleLock(lockPath), true)
		assertEquals(statSync(lockPath, { throwIfNoEntry: false }), undefined)

		writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8')
		assertEquals(clearStaleLock(lockPath), false)
		assertEquals(statSync(lockPath, { throwIfNoEntry: false }) != null, true)
	}
	finally { rmSync(dir, { recursive: true, force: true }) }
})

Deno.test('acquireLock: reclaims a stale lock, refuses a fresh one', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fount-deno-lock-'))
	const lockPath = join(dir, 'deno-update.lock')
	try {
		writeFileSync(lockPath, '', 'utf8')
		const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
		utimesSync(lockPath, old, old)
		const handle = acquireLock(lockPath)
		assertEquals(handle != null, true)
		handle.close()
		rmSync(lockPath, { force: true })

		const held = acquireLock(lockPath)
		assertEquals(held != null, true)
		try {
			assertEquals(acquireLock(lockPath), null)
		}
		finally {
			held.close()
			rmSync(lockPath, { force: true })
		}
	}
	finally { rmSync(dir, { recursive: true, force: true }) }
})
