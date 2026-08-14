/**
 * Azure Responses URL。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { azureResponsesUrl } from '../../src/url.mjs'

Deno.test('azureResponsesUrl from endpoint, resource, or full url', () => {
	assertEquals(
		azureResponsesUrl({ endpoint: 'https://ex.openai.azure.com' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
	assertEquals(
		azureResponsesUrl({ resource: 'ex' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
	assertEquals(
		azureResponsesUrl({ url: 'https://ex.openai.azure.com/openai/v1/responses' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
	assertEquals(
		azureResponsesUrl({ url: 'https://ex.openai.azure.com' }),
		'https://ex.openai.azure.com/openai/v1/responses',
	)
})
