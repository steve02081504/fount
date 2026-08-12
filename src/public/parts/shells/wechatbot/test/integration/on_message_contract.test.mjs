/**
 * WeChat OnMessage 契约：DM 主人直通、角色行 role/uid、非主人不回复。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import {
	assertCharReplyRowContract,
	assertOnMessageEventShape,
} from '../../../chat/test/bridgeContract.mjs'
import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'gentian_shell_contract'
const OWNER_WECHAT_ID = 'wx-owner-contract-1'

/**
 * @returns {{ context: object, sent: object[], enqueueUpdates: Function, abort: () => void }} mock 运行时
 */
function createFakeWechatRuntime() {
	/** @type {object[]} */
	const sent = []
	const abortController = new AbortController()
	/** @type {object[][]} */
	const updateBatches = []
	/** @type {((value?: unknown) => void) | null} */
	let waitingResolve = null

	/**
	 * @param {object[]} msgs 一批入站
	 * @returns {void}
	 */
	function enqueueUpdates(msgs) {
		updateBatches.push(msgs)
		waitingResolve?.()
		waitingResolve = null
	}

	const context = {
		signal: abortController.signal,
		cdnBaseUrl: 'https://example.invalid',
		/**
		 * @returns {Promise<object>} getUpdates 响应
		 */
		getUpdates: async () => {
			if (abortController.signal.aborted) throw new Error('aborted')
			if (updateBatches.length)
				return { ret: 0, msgs: updateBatches.shift(), get_updates_buf: 'cursor-1' }
			await new Promise(resolve => {
				waitingResolve = resolve
				abortController.signal.addEventListener('abort', () => resolve(), { once: true })
			})
			if (abortController.signal.aborted) throw new Error('aborted')
			return { ret: 0, msgs: updateBatches.shift() || [], get_updates_buf: 'cursor-2' }
		},
		/**
		 * @param {{ msg: object }} payload 出站
		 * @returns {Promise<object>} 假响应
		 */
		sendMessage: async payload => {
			sent.push(payload.msg)
			return { ret: 0 }
		},
		/**
		 * @returns {Promise<void>} typing
		 */
		sendTyping: async () => { },
		/**
		 * @returns {Promise<object>} 假上传
		 */
		uploadMedia: async () => {
			throw new Error('uploadMedia not used')
		},
	}

	return {
		context,
		sent,
		enqueueUpdates,
		/**
		 * @returns {void} 中止长轮询
		 */
		abort: () => abortController.abort(),
	}
}

/**
 * @param {object} overrides 覆盖
 * @param {object} enums WechatMessage* 枚举
 * @returns {object} 入站消息
 */
function makeWechatMessage(overrides, enums) {
	return {
		message_id: overrides.messageId || 7001,
		seq: overrides.seq || 1,
		client_id: overrides.clientId || 'c1',
		message_type: enums.WechatMessageType.USER,
		message_state: enums.WechatMessageState.FINISH,
		from_user_id: overrides.fromUserId || OWNER_WECHAT_ID,
		to_user_id: 'bot',
		context_token: 'tok-1',
		create_time_ms: Date.now(),
		...overrides.roomId ? { room_id: overrides.roomId, room_name: overrides.roomName } : {},
		item_list: [{
			type: enums.WechatMessageItemType.TEXT,
			text_item: { text: overrides.text || 'hello' },
		}],
	}
}

Deno.test('wechat OnMessage contract: owner DM replies and char row uses role/uid', async () => {
	const username = `wx-dm-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { onMessageProbe } = await import('../../../chat/test/fixtures/probes/onMessageProbe.mjs')
	onMessageProbe.reset()
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleWechatInterface } = await import('../../src/default_interface/main.mjs')
	const enums = await import('../../src/format.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../../chat/src/entity/member.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleWechatInterface(char, username, CHAR)
	const fake = createFakeWechatRuntime()
	const charUid = await ensureLocalAgentEntityHash(username, CHAR)

	const readyPromise = iface.OnceClientReady(fake.context, {
		OwnerWeChatId: OWNER_WECHAT_ID,
		OwnerPromptName: 'Owner',
	}, 'test-wx-bot')

	fake.enqueueUpdates([makeWechatMessage({ text: 'dm ping', messageId: 8001 }, enums)])

	try {
		await waitUntil(() => fake.sent.some(msg => {
			const texts = (msg.item_list || []).map(item => item.text_item?.text || '').join('\n')
			return texts.includes('gentian_shell_contract reply')
		}), 15000)
		assert(onMessageProbe.events.length >= 1)
		assertOnMessageEventShape(onMessageProbe.events[0], {
			platform: 'wechat',
			chatKind: 'dm',
			expectCharUid: charUid,
		})
		assertEquals(onMessageProbe.decisions.at(-1)?.isFromOwner, true)
		assertEquals(onMessageProbe.decisions.at(-1)?.wantsReply, true)

		const { getVirtualBridgeSession, virtualBridgeGroupId } = await import('../../../chat/src/chat/bridge/session.mjs')
		const logs = getVirtualBridgeSession(username, virtualBridgeGroupId('wechat', OWNER_WECHAT_ID))
			?.channels.default?.logs || []
		assertCharReplyRowContract(logs, charUid)
	}
	finally {
		fake.abort()
		await readyPromise.catch(() => { })
	}
})

Deno.test('wechat OnMessage contract: non-owner message does not reply', async () => {
	const username = `wx-stranger-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { onMessageProbe } = await import('../../../chat/test/fixtures/probes/onMessageProbe.mjs')
	onMessageProbe.reset()
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleWechatInterface } = await import('../../src/default_interface/main.mjs')
	const enums = await import('../../src/format.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleWechatInterface(char, username, CHAR)
	const fake = createFakeWechatRuntime()

	const readyPromise = iface.OnceClientReady(fake.context, {
		OwnerWeChatId: OWNER_WECHAT_ID,
		OwnerPromptName: 'Owner',
	}, 'test-wx-bot')

	fake.enqueueUpdates([makeWechatMessage({
		text: 'stranger ping',
		fromUserId: 'wx-stranger-9',
		messageId: 8002,
	}, enums)])

	try {
		await waitUntil(() => onMessageProbe.events.length >= 1, 15000)
		assertEquals(onMessageProbe.decisions.at(-1)?.isFromOwner, false)
		assertEquals(onMessageProbe.decisions.at(-1)?.wantsReply, false)
		assertEquals(fake.sent.length, 0)
	}
	finally {
		fake.abort()
		await readyPromise.catch(() => { })
	}
})

Deno.test('wechat unsupported bridge ops throw clearly', async () => {
	const username = `wx-ops-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleWechatInterface } = await import('../../src/default_interface/main.mjs')
	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleWechatInterface(char, username, CHAR)
	const fake = createFakeWechatRuntime()
	const readyPromise = iface.OnceClientReady(fake.context, {
		OwnerWeChatId: OWNER_WECHAT_ID,
		OwnerPromptName: 'Owner',
	}, 'test-wx-bot')

	try {
		const { requireBridgeOperation } = await import('../../../chat/src/chat/bridge/operations.mjs')
		const ops = ['listMembers', 'leaveChat', 'createInvite']
		for (const name of ops) {
			const fn = requireBridgeOperation(username, { platform: 'wechat', botname: 'test-wx-bot' }, name)
			let threw = false
			try {
				await fn({ platformChatId: OWNER_WECHAT_ID })
			}
			catch (error) {
				threw = true
				assert(String(error.message || '').includes('does not support'), name)
			}
			assert(threw, `${name} must throw`)
		}
	}
	finally {
		fake.abort()
		await readyPromise.catch(() => { })
	}
})
