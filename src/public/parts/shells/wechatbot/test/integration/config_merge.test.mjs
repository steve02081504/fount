/**
 * WeChat bot 配置写入回归：部分更新应合并进既有配置，不得整份替换（扫码登录只更新 token/apiBaseUrl/OwnerWeChatId）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot } from '../../../chat/test/harness.mjs'

Deno.test('wechatbot setBotConfig merges partial updates without dropping existing fields', async () => {
	const username = `wx-merge-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({ username })
	await boot.ensureServer()

	const { getBotConfig, setBotConfig } = await import('../../src/bot.mjs')
	const botname = 'merge-bot'
	const botConfig = {
		OwnerWeChatId: 'your_wechat_ilink_user_id',
		OwnerPromptName: 'steve',
	}

	setBotConfig(username, botname, {
		token: 'old-token',
		apiBaseUrl: 'https://old.example.com',
		char: 'urlChar',
		config: botConfig,
	})

	setBotConfig(username, botname, { token: 'new-token' })

	const afterPartial = getBotConfig(username, botname)
	assertEquals(afterPartial.token, 'new-token')
	assertEquals(afterPartial.apiBaseUrl, 'https://old.example.com')
	assertEquals(afterPartial.char, 'urlChar')
	assertEquals(afterPartial.config, botConfig)

	setBotConfig(username, botname, { config: { ...afterPartial.config, OwnerWeChatId: 'wx-owner' } })

	const afterQrLike = getBotConfig(username, botname)
	assertEquals(afterQrLike.char, 'urlChar')
	assertEquals(afterQrLike.token, 'new-token')
	assertEquals(afterQrLike.config, {
		OwnerWeChatId: 'wx-owner',
		OwnerPromptName: 'steve',
	})
})
