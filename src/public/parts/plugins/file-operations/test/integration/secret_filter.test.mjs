/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	collectEnvSecretValues,
	redactSecretValues,
	SECRET_REDACTION_PLACEHOLDER,
} from '../../../../../../scripts/secret_filter.mjs'

Deno.test('redactSecretValues replaces every occurrence of a known secret', () => {
	const text = 'token=sk-abcdef0123456789 rest sk-abcdef0123456789'
	assertEquals(
		redactSecretValues(text, ['sk-abcdef0123456789']),
		`token=${SECRET_REDACTION_PLACEHOLDER} rest ${SECRET_REDACTION_PLACEHOLDER}`,
	)
})

Deno.test('redactSecretValues replaces longer secrets first to avoid partial leftovers', () => {
	const secrets = ['sk-short', 'sk-short-extended']
	assertEquals(redactSecretValues('x sk-short-extended y', secrets), `x ${SECRET_REDACTION_PLACEHOLDER} y`)
})

Deno.test('redactSecretValues returns the input unchanged when there are no secrets', () => {
	assertEquals(redactSecretValues('plain text', []), 'plain text')
	assertEquals(redactSecretValues('plain text', undefined), 'plain text')
})

Deno.test('collectEnvSecretValues keeps values whose name ends with KEY and skips short ones', () => {
	assertEquals(
		collectEnvSecretValues({
			GEMINI_API_KEY: 'env-secret-8f3a1c2b4d5e',
			VT_KEY: 'another-secret-123456',
			FOUNT_TEST_SHORT_KEY: 'ab',
			UNRELATED: 'value',
		}),
		['env-secret-8f3a1c2b4d5e', 'another-secret-123456'],
	)
})
