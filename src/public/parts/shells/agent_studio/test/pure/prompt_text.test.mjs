/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { messagesToText } from '../../public/shared/promptText.mjs'

Deno.test('messagesToText joins role, name and content with blank lines', () => {
	const text = messagesToText([
		{ role: 'system', content: 'instruction' },
		{ role: 'user', name: 'alice', content: 'hello' },
	])
	assertEquals(text, 'system: instruction\n\nuser alice: hello')
})

Deno.test('messagesToText tolerates missing fields and empty input', () => {
	assertEquals(messagesToText([{ role: 'char', content: '' }]), 'char: ')
	assertEquals(messagesToText(undefined), '')
	assertEquals(messagesToText([]), '')
})
