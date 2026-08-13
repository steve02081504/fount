/**
 * jobCommand 往返：suite/subtest 边界不得被逗号列表吞掉。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { resolveSelector } from '../core/selector.mjs'
import { jobCommand } from '../kernel/jobs.mjs'

Deno.test('jobCommand emits a token per suite so subtests do not swallow later suites', () => {
	const spec = {
		groups: [{
			manifestSelectors: ['shells/chat'],
			suiteSelectors: ['pure', 'e2e_single'],
			subtestSelectors: { pure: ['channel_archive'] },
		}],
	}
	const command = jobCommand(spec)
	assertEquals(command, 'fount test shells/chat:pure:channel_archive shells/chat:e2e_single')
	const known = ['shells/chat']
	const parsed = command.split(' ').slice(2).map(token => resolveSelector(token, known))
	assertEquals(parsed, [
		{
			manifestId: 'shells/chat',
			suiteSelectors: ['pure'],
			subtestSelectors: { pure: ['channel_archive'] },
		},
		{
			manifestId: 'shells/chat',
			suiteSelectors: ['e2e_single'],
			subtestSelectors: {},
		},
	])
})
