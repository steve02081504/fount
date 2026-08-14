/**
 * Vertex 配置含 project/location，与 gemini apikey 模板分离。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import generator from '../../main.mjs'

Deno.test('Vertex template has project and location, no apikey field required', async () => {
	const template = await generator.interfaces.serviceGenerator.GetConfigTemplate()
	assertEquals(typeof template.project, 'string')
	assertEquals(typeof template.location, 'string')
	assertEquals('apikey' in template, false)
})
