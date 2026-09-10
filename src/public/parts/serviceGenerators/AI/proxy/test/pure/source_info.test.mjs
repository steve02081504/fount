/**
 * AI 源本地化 info 组装：模型名优先作源名称，URL 覆写时 provider 取域名。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildSourceInfo } from '../../src/sourceInfo.mjs'

const productInfo = {
	'en-UK': { avatar: 'a', description: 'd', provider: 'fount' },
}

Deno.test('model name wins over config.name', () => {
	const info = buildSourceInfo(productInfo, { model: 'gpt-4o', name: 'custom' })
	assertEquals(info['en-UK'].name, 'gpt-4o')
})

Deno.test('config.name is used when no model', () => {
	const info = buildSourceInfo(productInfo, { name: 'custom' })
	assertEquals(info['en-UK'].name, 'custom')
})

Deno.test('fallbackName is used when neither model nor name', () => {
	const info = buildSourceInfo(productInfo, {}, { fallbackName: 'Proxy' })
	assertEquals(info['en-UK'].name, 'Proxy')
})

Deno.test('info.model is never set', () => {
	const info = buildSourceInfo(productInfo, { model: 'gpt-4o' })
	assertEquals('model' in info['en-UK'], false)
})

Deno.test('default provider kept when url is absent or not overridden', () => {
	assertEquals(
		buildSourceInfo(productInfo, {})['en-UK'].provider,
		'fount',
	)
	assertEquals(
		buildSourceInfo(productInfo, {}, { url: 'https://api.openai.com/v1', defaultUrl: 'https://api.openai.com/v1' })['en-UK'].provider,
		'fount',
	)
})

Deno.test('overridden url becomes provider hostname', () => {
	const info = buildSourceInfo(productInfo, {}, {
		url: 'https://api.deepseek.com/v1/chat/completions',
		defaultUrl: 'https://api.openai.com/v1/chat/completions',
	})
	assertEquals(info['en-UK'].provider, 'api.deepseek.com')
})

Deno.test('invalid url keeps default provider', () => {
	const info = buildSourceInfo(productInfo, {}, { url: 'not a url', defaultUrl: '' })
	assertEquals(info['en-UK'].provider, 'fount')
})

Deno.test('product_info is not mutated', () => {
	buildSourceInfo(productInfo, { model: 'gpt-4o' }, { url: 'https://x.example.com', defaultUrl: '' })
	assertEquals(productInfo['en-UK'].name, undefined)
	assertEquals(productInfo['en-UK'].provider, 'fount')
})
