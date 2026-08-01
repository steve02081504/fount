/**
 * 测试 hub（固定生产口 8903；本自测用 18903 避开父进程 hub）。
 */
import { assertEquals } from 'jsr:@std/assert'
import process from 'node:process'

import { getTestHubBaseUrl } from '../hub/base_url.mjs'
import { isGithubIssueClosed } from '../hub/clients/github_issue.mjs'
import { hubSharedStoreDelete, hubSharedStoreGet, hubSharedStoreSet } from '../hub/clients/shared_store.mjs'
import { startTestHub } from '../hub/index.mjs'

/** 自测专用端口，避开 `fount test` 父进程占用的 8903。 */
const SELFTEST_HUB_PORT = 18903

Deno.test('test hub health + shared-store + github-issue invalid URL', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const hub = await startTestHub({ port: SELFTEST_HUB_PORT })
	process.env.FOUNT_TEST_HUB_URL = hub.url
	try {
		assertEquals(getTestHubBaseUrl(), hub.url)

		const health = await fetch(`${hub.url}/health`)
		assertEquals(health.status, 200)
		assertEquals(await health.json(), { ok: true })

		assertEquals(await hubSharedStoreGet('demo', 'k'), undefined)
		assertEquals(await hubSharedStoreSet('demo', 'k', { n: 1 }), true)
		assertEquals(await hubSharedStoreGet('demo', 'k'), { n: 1 })
		assertEquals(await hubSharedStoreDelete('demo', 'k'), true)
		assertEquals(await hubSharedStoreGet('demo', 'k'), undefined)

		assertEquals(await isGithubIssueClosed('https://example.com/issues/1'), false)
		assertEquals(await isGithubIssueClosed(''), false)
	}
	finally {
		await hub.close()
		if (previous === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previous
	}
})

Deno.test('isGithubIssueClosed without hub is false', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	delete process.env.FOUNT_TEST_HUB_URL
	try {
		assertEquals(getTestHubBaseUrl(), '')
		assertEquals(await isGithubIssueClosed('https://github.com/josdejong/svelte-jsoneditor/issues/584'), false)
	}
	finally {
		if (previous === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previous
	}
})
