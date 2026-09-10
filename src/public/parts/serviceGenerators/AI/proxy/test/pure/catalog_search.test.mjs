/**
 * models.dev 目录拍平 / 相关性排序 / API 基址转换。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	flattenCatalog,
	findCatalogEntry,
	providerApiToCompletionsUrl,
	searchCatalog,
} from '../../public/catalogSearch.mjs'

const apiData = {
	'nano-gpt': {
		id: 'nano-gpt',
		name: 'NanoGPT',
		api: 'https://nano-gpt.com/api',
		models: {
			'deepseek/deepseek-chat': { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', family: 'deepseek', limit: { context: 64, output: 8 } },
			'deepseek/deepseek-reasoner': { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', family: 'deepseek' },
		},
	},
	other: {
		id: 'other',
		name: 'Other',
		api: 'https://other.example.com',
		models: { 'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat' } },
	},
	deepseek: {
		id: 'deepseek',
		name: 'DeepSeek',
		api: 'https://api.deepseek.com',
		doc: 'https://api-docs.deepseek.com',
		models: {
			'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat', family: 'deepseek' },
			'deepseek-reasoner': { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', family: 'deepseek' },
		},
	},
}

const catalog = flattenCatalog(apiData)

Deno.test('flattenCatalog keeps provider / model fields', () => {
	const entry = catalog.find(e => e.providerId === 'nano-gpt' && e.modelId === 'deepseek/deepseek-chat')
	assertEquals(entry.providerApi, 'https://nano-gpt.com/api')
	assertEquals(entry.family, 'deepseek')
	assertEquals(entry.context, 64)
	assertEquals(entry.outputLimit, 8)
})

Deno.test('official provider outranks aggregators despite later catalog order', () => {
	const results = searchCatalog(catalog, 'deepseek')
	assertEquals(results.length > 0, true)
	assertEquals(results[0].providerId, 'deepseek')
	assertEquals(results[1].providerId, 'deepseek')
	assertEquals(catalog[0].providerId, 'nano-gpt')
})

Deno.test('search lowercases both sides', () => {
	const results = searchCatalog(catalog, 'DEEPSEEK')
	assertEquals(results[0].providerId, 'deepseek')
})

Deno.test('exact official model id outranks namespaced resellers', () => {
	const results = searchCatalog(catalog, 'deepseek-reasoner')
	assertEquals(results[0].providerId, 'deepseek')
	assertEquals(results[0].modelId, 'deepseek-reasoner')
})

Deno.test('provider API host is searchable', () => {
	const results = searchCatalog(catalog, 'api.deepseek.com')
	assertEquals(results.length, 2)
	assertEquals(results.every(entry => entry.providerId === 'deepseek'), true)
})

Deno.test('multi-term query keeps AND semantics and provider weight', () => {
	const results = searchCatalog(catalog, 'deepseek chat')
	assertEquals(results[0].providerId, 'deepseek')
	assertEquals(results.every(entry => /deepseek/i.test(`${entry.providerName} ${entry.modelName} ${entry.modelId}`)), true)
})

Deno.test('no match returns empty and limit is honored', () => {
	assertEquals(searchCatalog(catalog, 'gpt-5'), [])
	assertEquals(searchCatalog(catalog, ''), [])
	assertEquals(searchCatalog(catalog, 'deepseek', 1).length, 1)
})

Deno.test('findCatalogEntry matches model id + normalized API base', () => {
	const entry = findCatalogEntry(catalog, {
		model: 'deepseek-chat',
		url: 'https://api.deepseek.com/v1/chat/completions',
	})
	assertEquals(entry.providerId, 'deepseek')
	assertEquals(findCatalogEntry(catalog, { model: 'deepseek-chat', url: 'https://other.example.com/v1' }).providerId, 'other')
	assertEquals(findCatalogEntry(catalog, { model: 'missing', url: 'https://api.deepseek.com' }), null)
})

Deno.test('providerApiToCompletionsUrl appends chat/completions only when needed', () => {
	assertEquals(
		providerApiToCompletionsUrl('https://api.deepseek.com/v1'),
		'https://api.deepseek.com/v1/chat/completions',
	)
	assertEquals(
		providerApiToCompletionsUrl('https://api.openai.com/v1/chat/completions'),
		'https://api.openai.com/v1/chat/completions',
	)
	assertEquals(providerApiToCompletionsUrl(''), '')
})
