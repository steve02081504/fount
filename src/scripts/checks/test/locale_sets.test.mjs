/**
 * EULA / README / fount locale id 必须同一套。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { diffLocaleSets, scanLocaleIdSets } from '../locale_sets.mjs'

Deno.test('diffLocaleSets reports missing membership', () => {
	assertEquals(diffLocaleSets({
		a: ['en-UK', 'zh-CN'],
		b: ['en-UK', 'zh-CN'],
	}), [])
	assertEquals(diffLocaleSets({
		a: ['en-UK', 'pt-PT'],
		b: ['en-UK', 'pt-BR'],
	}), [
		{ id: 'pt-BR', missing: ['a'] },
		{ id: 'pt-PT', missing: ['b'] },
	])
})

Deno.test('repo: EULA, README, list.csv, locale JSON share locale ids', async () => {
	const { issues } = await scanLocaleIdSets(REPO_ROOT)
	assertEquals(issues, [], issues.map(issue => `${issue.id} missing in ${issue.missing.join(', ')}`).join('\n'))
})
