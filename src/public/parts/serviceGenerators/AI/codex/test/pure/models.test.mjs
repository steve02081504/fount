/**
 * Codex 模型目录：版本查询、可选模型过滤及推理强度。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { fetchCodexModels } from '../../src/models.mjs'

Deno.test('目录查询使用当前 client_version，仅回传可选模型和推理强度', async () => {
	const calls = []
	const fetcher = async (url, init) => {
		calls.push({ url: String(url), init })
		if (calls.length === 1) return Response.json({ version: '0.157.1' })
		return Response.json({ models: [
			{ slug: 'model-a', display_name: 'Model A', visibility: 'list', supported_in_api: true,
				default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }], secret: 'provider-private' },
			{ slug: 'hidden', visibility: 'hide', supported_reasoning_levels: [{ effort: 'high' }] },
			{ slug: 'unsupported', visibility: 'list', supported_in_api: false },
		] })
	}
	const models = await fetchCodexModels({ access: 'synthetic-access', accountId: 'account-1' }, fetcher)
	assertEquals(calls[0].url, 'https://registry.npmjs.org/@openai%2fcodex/latest')
	assertEquals(calls[0].init, undefined) // 不把 OAuth 凭证发给 npm。
	assertEquals(new URL(calls[1].url).searchParams.get('client_version'), '0.157.1')
	assertEquals(calls[1].init.headers.Authorization, 'Bearer synthetic-access')
	assertEquals(calls[1].init.headers['ChatGPT-Account-Id'], 'account-1')
	assertEquals(calls[1].init.redirect, 'error')
	assertEquals(models, [{
		slug: 'model-a', displayName: 'Model A', defaultReasoningLevel: 'medium',
		supportedReasoningLevels: ['low', 'ultra'],
	}])
	assertEquals(JSON.stringify(models).includes('synthetic-access'), false)
})

Deno.test('目录版本不可用时不向 Codex 发送任何凭证', async () => {
	let calls = 0
	const fetcher = async () => {
		calls++
		return Response.json({ version: 'not-a-version' })
	}
	await assertRejects(() => fetchCodexModels({ access: 'synthetic-access', accountId: 'account-1' }, fetcher), Error, 'Codex client version is unavailable')
	assertEquals(calls, 1)
})
