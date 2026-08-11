/**
 * Hub 消息操作门控：管理员可删他人人类消息；编辑不绑定 MANAGE_MESSAGES。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	canDeleteMessage,
	canEditMessage,
} from '../../public/shared/messagePermissions.mjs'

const VIEWER = 'a'.repeat(64)
const PEER = 'b'.repeat(64)
const EVENT = 'e'.repeat(64)
const VIEWER_ENTITY = '1'.repeat(128)

/**
 * @param {Partial<{ eventId: string, charId: string | null, authorPubKeyHash: string, isRemote: boolean, hasText: boolean }>} overrides 消息覆盖
 * @returns {object} 消息摘要
 */
function humanMessage(overrides = {}) {
	return {
		eventId: EVENT,
		charId: null,
		authorPubKeyHash: PEER,
		isRemote: false,
		hasText: true,
		...overrides,
	}
}

/**
 * @param {Partial<object>} overrides 选项覆盖
 * @returns {object} 门控选项
 */
function opts(overrides = {}) {
	return {
		viewerPubKeyHash: VIEWER,
		viewerEntityHash: VIEWER_ENTITY,
		canManageMessages: false,
		localCharIds: [],
		authorOwnerEntityHash: null,
		...overrides,
	}
}

Deno.test('admin can delete other human message with MANAGE_MESSAGES', () => {
	assertEquals(
		canDeleteMessage(humanMessage(), opts({ canManageMessages: true })),
		true,
	)
})

Deno.test('admin cannot edit other human message with only MANAGE_MESSAGES', () => {
	assertEquals(
		canEditMessage(humanMessage(), opts({ canManageMessages: true })),
		false,
	)
})

Deno.test('author can delete and edit own human message', () => {
	const message = humanMessage({ authorPubKeyHash: VIEWER })
	assertEquals(canDeleteMessage(message, opts()), true)
	assertEquals(canEditMessage(message, opts()), true)
})

Deno.test('plain member cannot delete or edit other human message', () => {
	const message = humanMessage()
	assertEquals(canDeleteMessage(message, opts()), false)
	assertEquals(canEditMessage(message, opts()), false)
})

Deno.test('owner can delete and edit owned agent message', () => {
	const message = humanMessage({
		charId: 'agent_a',
		authorPubKeyHash: PEER,
	})
	const options = opts({ authorOwnerEntityHash: VIEWER_ENTITY })
	assertEquals(canDeleteMessage(message, options), true)
	assertEquals(canEditMessage(message, options), true)
})
