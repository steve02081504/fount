/**
 * GitHub issue 缓存：队列空时丢掉超过 1h 的条目。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { GithubIssueCache, ISSUE_CACHE_PRUNE_MS } from '../hub/apis/github_issue.mjs'

Deno.test('GithubIssueCache stores probe once then reuses', async () => {
	const cache = new GithubIssueCache()
	let probes = 0
	/**
	 * 计数并视为已关。
	 * @returns {Promise<boolean>} 已关闭
	 */
	const probe = async () => { probes++; return true }
	assertEquals(await cache.getClosed('https://github.com/a/b/issues/1', probe, () => 0), true)
	assertEquals(await cache.getClosed('https://github.com/a/b/issues/1', probe, () => 0), true)
	assertEquals(probes, 1)
})

Deno.test('GithubIssueCache getState keeps closedAt', async () => {
	const cache = new GithubIssueCache()
	const url = 'https://github.com/a/b/issues/1'
	assertEquals(await cache.getState(url, async () => ({ closed: true, closedAt: 1_700_000_000_000 }), () => 0), {
		closed: true,
		closedAt: 1_700_000_000_000,
	})
	assertEquals(await cache.getState(url, async () => ({ closed: false, closedAt: null }), () => 0), {
		closed: true,
		closedAt: 1_700_000_000_000,
	})
})

Deno.test('GithubIssueCache pruneOlderThan drops stale entries', async () => {
	const cache = new GithubIssueCache()
	await cache.getClosed('https://github.com/a/b/issues/1', async () => false, () => 0)
	await cache.getClosed('https://github.com/a/b/issues/2', async () => true, () => ISSUE_CACHE_PRUNE_MS + 10)
	assertEquals(cache.pruneOlderThan(ISSUE_CACHE_PRUNE_MS, () => ISSUE_CACHE_PRUNE_MS + 20), 1)
	assertEquals(cache.entries.has('https://github.com/a/b/issues/1'), false)
	assertEquals(cache.entries.has('https://github.com/a/b/issues/2'), true)
})
