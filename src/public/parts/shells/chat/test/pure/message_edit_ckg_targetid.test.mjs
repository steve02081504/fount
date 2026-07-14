/**
 * 缺陷A 回归：message_edit 的 targetId 等结构字段在 CKG 加密后仍以明文留在 content 顶层，
 * 因此联邦出站中继（canRelayFederatedEvent → checkEventPermission）与入站鉴权仍能读到 targetId，
 * 而用户正文（newContent）保持加密。整个事件由作者 Ed25519 签名保护，明文 targetId 不削弱机密性。
 */
/* global Deno */
import { decryptWithChannelKey, encryptWithChannelKey } from 'npm:@steve02081504/fount-p2p/crypto/channel'
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	assertFederatedCkgContent,
	clearFieldsFromCkgEnvelope,
	isCkgEncryptedContent,
	partitionCkgContentFields,
	plaintextCkgContentFields,
} from '../../src/chat/channel_keys/content.mjs'
import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import { canRelayFederatedEvent } from '../../src/chat/federation/acl.mjs'

const AUTHOR = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const TARGET = 'd'.repeat(64)
const KEY_HEX = '1'.repeat(64)
const CHANNEL = 'default'

/**
 * 模拟 encryptEventContent 的字段拆分 + 加密（不依赖磁盘密钥）。
 * @param {object} content 明文 content
 * @param {string[]} plaintextFields 保持明文的字段
 * @returns {object} ckg 信封 content
 */
function encryptLikeAppend(content, plaintextFields) {
	const { clear, secret } = partitionCkgContentFields(content, plaintextFields)
	return { ...encryptWithChannelKey(JSON.stringify(secret), KEY_HEX, CHANNEL, 1), ...clear }
}

/**
 * 模拟 decryptEventContent 的合并还原。
 * @param {object} envelope ckg 信封 content
 * @returns {object} 还原后的完整 content
 */
function decryptLikeRead(envelope) {
	const text = decryptWithChannelKey(envelope, KEY_HEX, CHANNEL)
	return { ...clearFieldsFromCkgEnvelope(envelope), ...JSON.parse(text) }
}

/**
 * 构造最小可判权的物化状态桩。
 * @param {object} [overrides] state 覆盖项
 * @returns {object} 最小可判权的物化状态桩
 */
function baseState(overrides = {}) {
	return {
		members: {
			[AUTHOR]: { status: 'active', roles: ['@everyone'] },
			[OTHER]: { status: 'active', roles: ['@everyone'] },
		},
		roles: { '@everyone': { permissions: { SEND_MESSAGES: true } } },
		channels: {},
		channelPermissions: {},
		groupSettings: {},
		messageSenderIndex: { [TARGET]: { sender: AUTHOR, charId: null, channelId: CHANNEL } },
		messageOverlay: { deletedIds: new Set() },
		...overrides,
	}
}

Deno.test('plaintextCkgContentFields exposes targetId for message_edit; vote metadata for message', () => {
	assertEquals(plaintextCkgContentFields('message_edit'), ['targetId'])
	assertEquals(plaintextCkgContentFields('message'), ['type', 'deadline', 'question', 'options'])
})

Deno.test('message_edit ckg envelope keeps targetId plaintext and encrypts the body', () => {
	const content = {
		targetId: TARGET,
		newContent: { type: 'text', content: 'secret body' },
		chatLogEntryId: 'entry-1',
	}
	const envelope = encryptLikeAppend(content, plaintextCkgContentFields('message_edit'))

	// targetId 明文可见；正文已加密（不出现在信封顶层）。
	assertEquals(envelope.targetId, TARGET)
	assertEquals(envelope.newContent, undefined)
	assert(isCkgEncryptedContent(envelope))
	// 入站 CKG 校验通过（仍是 ckg 密文）。
	assertFederatedCkgContent('message_edit', envelope)

	// 解密后完整还原（明文结构字段 + 解密正文）。
	assertEquals(decryptLikeRead(envelope), content)
})

Deno.test('message ckg envelope keeps type plaintext and encrypts user body', () => {
	const content = { type: 'text', content: 'hello' }
	const envelope = encryptLikeAppend(content, plaintextCkgContentFields('message'))
	assertEquals(clearFieldsFromCkgEnvelope(envelope), { type: 'text' })
	assertEquals(envelope.content, undefined)
	assertEquals(decryptLikeRead(envelope), content)
})

Deno.test('vote message ckg envelope keeps ballot metadata plaintext', () => {
	const content = {
		type: 'vote',
		question: 'pick one',
		options: ['a', 'b'],
		deadline: '2099-01-01T00:00:00.000Z',
	}
	const envelope = encryptLikeAppend(content, plaintextCkgContentFields('message'))
	assertEquals(clearFieldsFromCkgEnvelope(envelope), content)
	assert(isCkgEncryptedContent(envelope))
})

Deno.test('authorizeEvent reads targetId from encrypted message_edit and authorizes author', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { type: 'text', content: 'x' } },
		plaintextCkgContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	assertEquals((await checkEventPermission(baseState(), event, AUTHOR)).ok, true)
})

Deno.test('encrypted message_edit passes outbound federation relay ACL', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { type: 'text', content: 'x' } },
		plaintextCkgContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	assertEquals(await canRelayFederatedEvent(baseState(), event), true)
})

Deno.test('encrypted message_edit with absent target stays deferrable (quarantine, not drop)', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { type: 'text', content: 'x' } },
		plaintextCkgContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	const state = baseState({ messageSenderIndex: {} })
	const result = await checkEventPermission(state, event, AUTHOR)
	assertEquals(result.ok, false)
	assertEquals(result.deferrable, true)
})
