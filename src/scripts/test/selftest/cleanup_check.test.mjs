/**
 * 残留物检测：退出码常量、Windows/CI 门控与扫描结果。
 */
/* global Deno */
import process from 'node:process'

import { assertEquals, assert } from 'jsr:@std/assert'

import { CLEANUP_LEAK_EXIT_CODE, findCleanupLeaks, inGitHubActions, isWindows } from '../core/cleanup_check.mjs'

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

Deno.test('findCleanupLeaks returns empty on non-Windows', () => {
	if (isWindows()) return
	assertEquals(findCleanupLeaks(), [])
})

/**
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @returns {void}
 */
function assertNot(actual, expected) {
	assert(actual !== expected, `expected ${actual} not to equal ${expected}`)
}
