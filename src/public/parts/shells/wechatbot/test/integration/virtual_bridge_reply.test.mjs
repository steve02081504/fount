/**
 * WeChat 虚拟桥接验收：mock getUpdates/sendMessage + 无 AI 角色，断言出站。
 */
/* global Deno */
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'on_message_yes'

/**
 * @returns {{ context: object, sent: object[], enqueueUpdates: Function, abort: () => void }} mock 微信运行时
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
	 * @param {object[]} msgs 一批入站消息
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
		sendTyping: async () => {},
		/**
		 * @returns {Promise<object>} 假上传
		 */
		uploadMedia: async () => {
			throw new Error('uploadMedia not used in text smoke')
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

Deno.test('wechat virtual bridge: getUpdates → GetReply → sendMessage', async () => {
	const username = `wx-virtual-${crypto.randomUUID().slice(0, 8)}`
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
	onMessageProbe.returnValue = true

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleWechatInterface } = await import('../../src/default_interface/main.mjs')
	const { WechatMessageItemType, WechatMessageState, WechatMessageType } = await import('../../src/format.mjs')
	const { enumerateJoinedFederatedGroups } = await import('../../../chat/src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../../chat/src/chat/lib/replica.mjs')

	const ownerWeChatId = 'wx-owner-001'
	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleWechatInterface(char, username, CHAR)
	const fake = createFakeWechatRuntime()

	const readyPromise = iface.OnceClientReady(fake.context, {
		OwnerWeChatId: ownerWeChatId,
		OwnerPromptName: 'Owner',
	}, 'test-wx-bot')

	const operatorHash = await resolveOperatorEntityHash(username)
	const groupsBefore = await enumerateJoinedFederatedGroups(username, operatorHash)

	fake.enqueueUpdates([{
		message_id: 7001,
		seq: 1,
		client_id: 'c1',
		message_type: WechatMessageType.USER,
		message_state: WechatMessageState.FINISH,
		from_user_id: ownerWeChatId,
		to_user_id: 'bot',
		context_token: 'tok-1',
		create_time_ms: Date.now(),
		item_list: [{
			type: WechatMessageItemType.TEXT,
			text_item: { text: 'hello virtual wechat bridge' },
		}],
	}])

	try {
		await waitUntil(() => fake.sent.some(msg => {
			const texts = (msg.item_list || [])
				.map(item => item.text_item?.text || '')
				.join('\n')
			return texts.includes('on_message_yes reply')
		}), 15000)
		assert(onMessageProbe.replies >= 1)

		const groupsAfter = await enumerateJoinedFederatedGroups(username, operatorHash)
		assert(groupsAfter.length === groupsBefore.length, 'virtual bridge must not create real chat groups')
	}
	finally {
		fake.abort()
		await readyPromise.catch(() => {})
	}
})
