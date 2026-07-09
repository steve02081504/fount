/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveSelector } from '../core/selector.mjs'
import { goalExplicit } from '../runner/selection.mjs'

Deno.test('resolveSelector slash form matches longest manifest prefix', () => {
	const known = ['server', 'shells/chat', 'shells/social']
	assertEquals(resolveSelector('shells/chat/fed_core', known)?.manifestId, 'shells/chat')
})

Deno.test('goalExplicit marks every selected suite', () => {
	const suites = [
		{ manifestId: 'server', name: 'live', id: 'live', run: [], triggers: [], manifestPath: '', heavy: false },
	]
	const { goalKeys, goalEvidenceByKey } = goalExplicit(suites)
	assertEquals([...goalKeys], ['server/live'])
	assertEquals(goalEvidenceByKey.get('server/live')?.kind, 'explicit_selected')
})
