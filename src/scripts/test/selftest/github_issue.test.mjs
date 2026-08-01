/**
 * `parseGithubIssueUrl`（纯解析，不打 gh）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { parseGithubIssueUrl } from '../core/github_issue.mjs'

Deno.test('parseGithubIssueUrl accepts canonical issue URLs', () => {
	assertEquals(parseGithubIssueUrl('https://github.com/josdejong/svelte-jsoneditor/issues/584'), {
		owner: 'josdejong',
		repo: 'svelte-jsoneditor',
		number: '584',
	})
})

Deno.test('parseGithubIssueUrl rejects non-issue URLs', () => {
	assertEquals(parseGithubIssueUrl('https://github.com/josdejong/svelte-jsoneditor/pull/580'), null)
	assertEquals(parseGithubIssueUrl('https://example.com/issues/1'), null)
	assertEquals(parseGithubIssueUrl(''), null)
	assertEquals(
		parseGithubIssueUrl('https://github.com/josdejong/svelte-jsoneditor/issues/584#issuecomment-1'),
		null,
	)
	assertEquals(
		parseGithubIssueUrl('https://github.com/josdejong/svelte-jsoneditor/issues/584/'),
		null,
	)
})
