/**
 * 泛型 registries 聚合单元测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { partpathToUrlPrefix, resolveRegistryPathToUrl } from '../server/registries.mjs'

Deno.test('partpathToUrlPrefix maps shells/chat', () => {
	assertEquals(partpathToUrlPrefix('shells/chat'), '/parts/shells:chat')
})

Deno.test('resolveRegistryPathToUrl joins part-relative path', () => {
	assertEquals(
		resolveRegistryPathToUrl('shells/chat', 'markdown_ext/index.mjs'),
		'/parts/shells:chat/markdown_ext/index.mjs',
	)
})
