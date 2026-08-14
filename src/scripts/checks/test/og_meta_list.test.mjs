/**
 * og meta 提取。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import { extractOgMeta, inspectOgMeta } from '../og_meta_list.mjs'
import { parseHTML } from 'npm:linkedom'

Deno.test('extractOgMeta reads head meta tags', () => {
	const { document } = parseHTML(`<!DOCTYPE html><html><head>
		<meta property="og:title" content="The Stage: fount" />
		<meta property="og:description" content="Where words take flight." />
	</head></html>`)
	assertEquals(extractOgMeta(document), {
		title: 'The Stage: fount',
		description: 'Where words take flight.',
	})
})

Deno.test('inspectOgMeta skips fragments and pages without og meta', () => {
	assertEquals(inspectOgMeta('<div>fragment</div>').skipped, true)
	assertEquals(inspectOgMeta('<!DOCTYPE html><html><head></head><body></body></html>').skipped, true)
})
