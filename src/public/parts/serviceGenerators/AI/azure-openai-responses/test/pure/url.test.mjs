/**
 * Azure Responses 端点拼接。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { azureResponsesUrl } from '../../src/url.mjs'

Deno.test('azureResponsesUrl from endpoint, resource, or bare host', () => {
	assertEquals(
		azureResponsesUrl({ endpoint: 'https://ex.openai.azure.com' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
	assertEquals(
		azureResponsesUrl({ endpoint: 'ex.openai.azure.com' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
	assertEquals(
		azureResponsesUrl({ resource: 'ex' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
})
