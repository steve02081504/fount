/**
 * AI Gateway 通道。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { cloudflareGatewayRoute } from '../../src/route.mjs'

Deno.test('cloudflareGatewayRoute by model prefix', () => {
	assertEquals(
		cloudflareGatewayRoute({ accountId: 'a', gatewayId: 'g', model: 'openai/gpt-4.1' }),
		{ channel: 'openai', url: 'https://gateway.ai.cloudflare.com/v1/a/g/openai/chat/completions', model: 'gpt-4.1' },
	)
	assertEquals(
		cloudflareGatewayRoute({ accountId: 'a', gatewayId: 'g', model: 'anthropic/claude-sonnet-4-5' }).channel,
		'anthropic',
	)
	assertEquals(
		cloudflareGatewayRoute({ accountId: 'a', gatewayId: 'g', model: '@cf/meta/llama' }).channel,
		'compat',
	)
})
