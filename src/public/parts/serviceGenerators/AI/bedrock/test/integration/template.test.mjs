/**
 * Bedrock 配置模板含 region。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import generator from '../../main.mjs'

Deno.test('Bedrock template has region and model', async () => {
	const template = await generator.interfaces.serviceGenerator.GetConfigTemplate()
	assertEquals(typeof template.region, 'string')
	assertEquals(typeof template.model, 'string')
})
