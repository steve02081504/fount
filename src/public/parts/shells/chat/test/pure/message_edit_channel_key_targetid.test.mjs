/**
 * 回归：message_edit 的 targetId 等结构字段在频道密钥加密后仍以明文留在 content 顶层，
 * 因此联邦出站中继（canRelayFederatedEvent → checkEventPermission）与入站鉴权仍能读到 targetId，
 * 而用户正文（newContent）保持加密。整个事件由作者 Ed25519 签名保护，明文 targetId 不削弱机密性。
 */
/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { decryptWithChannelKey, encryptWithChannelKey } from 'npm:@steve02081504/fount-p2p/crypto/channel'

import {
	assertFederatedChannelKeyContent,
	clearFieldsFromChannelKeyEnvelope,
	isChannelKeyEncryptedContent,
	partitionChannelKeyContentFields,
	plaintextChannelKeyContentFields,
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
 * @returns {object} 频道密钥信封 content
 */
function encryptLikeAppend(content, plaintextFields) {
	const { clear, secret } = partitionChannelKeyContentFields(content, plaintextFields)
	return { ...encryptWithChannelKey(JSON.stringify(secret), KEY_HEX, CHANNEL, 1), ...clear }
}

/**
 * 模拟 decryptEventContent 的合并还原。
 * @param {object} envelope 频道密钥信封 content
 * @returns {object} 还原后的完整 content
 */
function decryptLikeRead(envelope) {
	return { ...clearFieldsFromChannelKeyEnvelope(envelope), ...JSON.parse(decryptWithChannelKey(envelope, KEY_HEX, CHANNEL)) }
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

Deno.test('plaintextChannelKeyContentFields exposes targetId for message_edit; vote fields for message', () => {
	assertEquals(plaintextChannelKeyContentFields('message_edit'), ['targetId', 'extension'])
	assertEquals(plaintextChannelKeyContentFields('message'), ['extension', 'type', 'question', 'options', 'deadline'])
})

Deno.test('message_edit channel-key envelope keeps targetId plaintext and encrypts the body', () => {
	const content = {
		targetId: TARGET,
		newContent: { content: 'secret body' },
		extension: { chat: { entryId: 'entry-1' } },
	}
	const envelope = encryptLikeAppend(content, plaintextChannelKeyContentFields('message_edit'))

	// targetId 与 extension.chat.entryId 明文可见；正文已加密（不出现在信封顶层）。
	assertEquals(envelope.targetId, TARGET)
	assertEquals(envelope.extension, { chat: { entryId: 'entry-1' } })
	assertEquals(envelope.newContent, undefined)
	assert(isChannelKeyEncryptedContent(envelope))
	assertFederatedChannelKeyContent('message_edit', envelope)

	assertEquals(decryptLikeRead(envelope), content)
})

Deno.test('message channel-key envelope keeps extension plaintext and encrypts user body', () => {
	const content = { content: 'hello' }
	const envelope = encryptLikeAppend(content, plaintextChannelKeyContentFields('message'))
	assertEquals(clearFieldsFromChannelKeyEnvelope(envelope), {})
	assertEquals(envelope.content, undefined)
	assertEquals(decryptLikeRead(envelope), content)
})

Deno.test('vote message channel-key envelope keeps ballot metadata plaintext at top level', () => {
	const content = {
		type: 'vote',
		question: 'pick one',
		options: ['a', 'b'],
		deadline: '2099-01-01T00:00:00.000Z',
	}
	const envelope = encryptLikeAppend(content, plaintextChannelKeyContentFields('message'))
	assertEquals(clearFieldsFromChannelKeyEnvelope(envelope), {
		type: 'vote',
		question: 'pick one',
		options: ['a', 'b'],
		deadline: '2099-01-01T00:00:00.000Z',
	})
	assert(isChannelKeyEncryptedContent(envelope))
})

Deno.test('authorizeEvent reads targetId from encrypted message_edit and authorizes author', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { content: 'x' } },
		plaintextChannelKeyContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	assertEquals((await checkEventPermission(baseState(), event, AUTHOR)).ok, true)
})

Deno.test('encrypted message_edit passes outbound federation relay ACL', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { content: 'x' } },
		plaintextChannelKeyContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	assertEquals(await canRelayFederatedEvent(baseState(), event), true)
})

Deno.test('encrypted message_edit with absent target stays deferrable (quarantine, not drop)', async () => {
	const content = encryptLikeAppend(
		{ targetId: TARGET, newContent: { content: 'x' } },
		plaintextChannelKeyContentFields('message_edit'),
	)
	const event = { type: 'message_edit', channelId: CHANNEL, sender: AUTHOR, content }
	const result = await checkEventPermission(baseState({ messageSenderIndex: {} }), event, AUTHOR)
	assertEquals(result.ok, false)
	assertEquals(result.deferrable, true)
})
