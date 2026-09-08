/**
 * 残留物检测：退出码常量、CI 门控、ms-playwright / fount 临时目录扫描。
 */
/* global Deno */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assertEquals, assert } from 'jsr:@std/assert'

import { CLEANUP_LEAK_EXIT_CODE, findCleanupLeaks, inGitHubActions, isWindows, msPlaywrightPath } from '../core/cleanup_check.mjs'

Deno.test('cleanup leak exit code is distinct from pass/fail', () => {
	assertEquals(CLEANUP_LEAK_EXIT_CODE, 3)
	assertNot(CLEANUP_LEAK_EXIT_CODE, 0)
	assertNot(CLEANUP_LEAK_EXIT_CODE, 1)
	assertNot(CLEANUP_LEAK_EXIT_CODE, 2)
})

Deno.test('inGitHubActions reflects GITHUB_ACTIONS env', () => {
	const original = process.env.GITHUB_ACTIONS
	process.env.GITHUB_ACTIONS = 'true'
	assertEquals(inGitHubActions(), true)
	process.env.GITHUB_ACTIONS = 'false'
	assertEquals(inGitHubActions(), false)
	if (original === undefined) delete process.env.GITHUB_ACTIONS
	else process.env.GITHUB_ACTIONS = original
})

Deno.test('findCleanupLeaks returns empty on CI regardless of platform', () => {
	const original = process.env.GITHUB_ACTIONS
	process.env.GITHUB_ACTIONS = 'true'
	try {
		assertEquals(findCleanupLeaks(), [])
	}
	finally {
		if (original === undefined) delete process.env.GITHUB_ACTIONS
		else process.env.GITHUB_ACTIONS = original
	}
})

Deno.test('findCleanupLeaks stays empty when no ms-playwright dir exists', () => {
	if (inGitHubActions()) return
	withIsolatedCleanupEnv(scratch => {
		assertEquals(findCleanupLeaks(), [])
	})
})

Deno.test('findCleanupLeaks reports a stray ms-playwright dir', () => {
	if (inGitHubActions()) return
	withIsolatedCleanupEnv(scratch => {
		const expected = msPlaywrightPath()
		mkdirSync(expected, { recursive: true })
		const leaks = findCleanupLeaks()
		assert(leaks.includes(expected), `expected ms-playwright leak, got ${JSON.stringify(leaks)}`)
	})
})

/**
 * 在隔离的临时环境里跑断言：把本机 ms-playwright 位置与临时目录都指到
 * 一个一次性 scratch（fount- 前缀），避免触碰真实用户目录、也不受
 * 真实临时目录里其他 fount[-_]* 条目干扰；无论断言成败都恢复 env 并清理。
 * @param {(scratch: string) => void} callback 断言回调，参数为隔离根目录
 * @returns {void}
 */
function withIsolatedCleanupEnv(callback) {
	const scratch = mkdtempSync(join(tmpdir(), 'fount-cleanup-test-'))
	const saved = /** @type {Record<string, string | undefined>} */ {}
	for (const key of ['LOCALAPPDATA', 'XDG_CACHE_HOME', 'HOME', 'TEMP', 'TMP', 'TMPDIR'])
		saved[key] = process.env[key]
	try {
		if (isWindows()) process.env.LOCALAPPDATA = scratch
		else if (process.platform === 'darwin') process.env.HOME = scratch
		else process.env.XDG_CACHE_HOME = scratch
		process.env.TEMP = scratch
		process.env.TMP = scratch
		process.env.TMPDIR = scratch
		callback(scratch)
	}
	finally {
		for (const key of Object.keys(saved)) {
			const value = saved[key]
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
		rmSync(scratch, { recursive: true, force: true })
	}
}

/**
 * 断言实际值不等于期望值。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @returns {void}
 */
function assertNot(actual, expected) {
	assert(actual !== expected, `expected ${actual} not to equal ${expected}`)
}
