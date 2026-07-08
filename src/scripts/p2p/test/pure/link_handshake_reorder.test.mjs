/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import { buildAuth, buildHello } from '../../link/handshake.mjs'
import { createLink } from '../../link/link.mjs'

/**
 * 回归：握手必须容忍 auth 早于 hello 到达。
 *
 * 双向同时建链（warmup connect-node）时，initiator 侧的 localDescription 早已就绪，
 * 一收到对端 hello 便立刻 maybeSendAuth，此时它自身的 hello（等 data channel open 后才发）可能还没发出，
 * 于是对端（answerer）先收到 auth、后收到 hello。旧实现里 handleAuth 在 remoteHello 未就绪时直接丢弃 auth，
 * 导致 answerer 的 remoteAuthVerified 永远为 false → 握手超时 → 连接坍塌 → 联邦 members>=2 永不满足。
 */

const ALICE_FP = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99'
const BOB_FP = '11:22:33:44:55:66:77:88:99:00:aa:bb:cc:dd:ee:ff:11:22:33:44:55:66:77:88:99:00:aa:bb:cc:dd:ee:ff'

/**
 * 构造带 DTLS fingerprint 的最小 SDP。
 * @param {string} type offer/answer
 * @param {string} fingerprint DTLS fingerprint
 * @returns {string} SDP 文本
 */
function sdpWithFingerprint(type, fingerprint) {
	return `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 ${fingerprint}\r\na=${type}\r\n`
}

/**
 * 最小可控 data channel mock（默认 open，捕获出站、可注入入站）。
 */
class MockDataChannel {
	/** @param {string} label 通道名 */
	constructor(label) {
		this.label = label
		this.readyState = 'open'
		this.bufferedAmount = 0
		this.bufferedAmountLowThreshold = 0
		this.onmessage = null
		this.onopen = null
		this.onclose = null
		this.onbufferedamountlow = null
		/** @type {string[]} 出站帧 */
		this.sent = []
		/** @type {Map<string, Set<Function>>} */
		this._listeners = new Map()
	}

	/**
	 * @param {string} type 事件名
	 * @param {Function} handler 处理器
	 */
	addEventListener(type, handler) {
		if (!this._listeners.has(type)) this._listeners.set(type, new Set())
		this._listeners.get(type).add(handler)
	}

	/**
	 * @param {string} type 事件名
	 * @param {Function} handler 处理器
	 */
	removeEventListener(type, handler) {
		this._listeners.get(type)?.delete(handler)
	}

	/** @param {string|Uint8Array} data 出站数据 */
	send(data) {
		this.sent.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
	}

	/** 关闭通道。 */
	close() {
		this.readyState = 'closed'
	}

	/** @param {string} data 注入的入站帧 */
	deliverInbound(data) {
		this.onmessage?.({ data })
	}
}

/**
 * answerer 侧最小 RTCPeerConnection mock：收到 offer 后就绪双通道，答复 answer。
 * @returns {{ RTCPeerConnection: typeof MockPC, getInstance: () => MockPC | null }} rtc 工厂与实例取回器
 */
function createAnswererRtc() {
	/** @type {MockPC | null} */
	let instance = null
	/** 最小 RTCPeerConnection mock。 */
	class MockPC {
		/** 初始化为已连接的稳定状态。 */
		constructor() {
			this.localDescription = null
			this.remoteDescription = null
			this.signalingState = 'stable'
			this.iceGatheringState = 'complete'
			this.connectionState = 'connected'
			this.iceConnectionState = 'connected'
			this.onicecandidate = null
			this.ondatachannel = null
			this.onconnectionstatechange = null
			/** @type {Record<string, MockDataChannel>} */
			this.channels = {}
			instance = this
		}

		/** @returns {Promise<{type: string, sdp: string}>} answer 描述 */
		async createAnswer() { return { type: 'answer', sdp: sdpWithFingerprint('answer', BOB_FP) } }

		/** @param {{type: string, sdp: string}} desc 本地描述 */
		async setLocalDescription(desc) {
			this.localDescription = desc
			this.signalingState = 'stable'
		}

		/** @param {{type: string, sdp: string}} desc 远端描述 */
		async setRemoteDescription(desc) {
			this.remoteDescription = desc
			if (desc.type === 'offer') {
				this.signalingState = 'have-remote-offer'
				// answerer 由 ondatachannel 获得 initiator 建立的双通道（此处即刻 open）。
				for (const label of ['control', 'bulk']) {
					const channel = new MockDataChannel(label)
					this.channels[label] = channel
					this.ondatachannel?.({ channel })
				}
			}
			else this.signalingState = 'stable'
		}

		/** trickle 关闭时不经此路径。 */
		async addIceCandidate() { }
		/** 标记连接关闭。 */
		async close() { this.connectionState = 'closed' }
	}
	return {
		RTCPeerConnection: MockPC,
		/** @returns {MockPC | null} 最近创建的 mock 实例 */
		getInstance: () => instance,
	}
}

Deno.test({
	name: 'link handshake completes when auth arrives before hello (answerer)',
	sanitizeOps: false,
	sanitizeResources: false,
	/** @returns {Promise<void>} */
	async fn() {
		const alice = keyPairFromSeed(Buffer.alloc(32, 3))
		const aliceNodeHash = pubKeyHash(alice.publicKey)
		const aliceNodePubKey = Buffer.from(alice.publicKey).toString('hex')
		const bob = keyPairFromSeed(Buffer.alloc(32, 4))
		const bobNodeHash = pubKeyHash(bob.publicKey)

		const rtc = createAnswererRtc()
		/** @type {((message: unknown) => void) | null} */
		let signalHandler = null
		const signal = {
			/** @param {unknown} _message 出站信令（answer/ice，测试中忽略） */
			send(_message) {},
			/**
			 * @param {(message: unknown) => void} handler 入站信令处理器
			 * @returns {() => void} 取消订阅
			 */
			onRemote(handler) { signalHandler = handler; return () => { signalHandler = null } },
		}

		const link = await createLink({
			nodeHash: aliceNodeHash,
			initiator: false,
			signal,
			rtc,
			iceServers: [],
			localIdentity: { nodeHash: bobNodeHash, nodePubKey: Buffer.from(bob.publicKey).toString('hex'), secretKey: bob.secretKey },
			handshakeTimeoutMs: 3000,
		})

		try {
			// 1) 投递 alice 的 offer → answerer 建立双通道并发出自身 hello。
			signalHandler({ type: 'description', description: { type: 'offer', sdp: sdpWithFingerprint('offer', ALICE_FP) } })
			// 等 answerer 完成 setRemoteDescription→ondatachannel→postOpenFlow→发 hello。
			const controlChannel = await pollFor(() => {
				const channel = rtc.getInstance()?.channels?.control
				return channel && channel.sent.some(text => text.includes('"hello"')) ? channel : null
			}, 3000)

			const bobHello = JSON.parse(controlChannel.sent.find(text => text.includes('"hello"')))
			const bobNonce = bobHello.nonce

			// 2) 关键：alice 先回 auth（其 localDescription 早就绪），随后才发 hello——answerer 收到的顺序被颠倒。
			const aliceAuth = await buildAuth(bobNonce, ALICE_FP, { secretKey: alice.secretKey, nodeHash: aliceNodeHash })
			const aliceHello = buildHello({ nodeHash: aliceNodeHash, nodePubKey: aliceNodePubKey, nonce: 'ab'.repeat(32) })
			controlChannel.deliverInbound(JSON.stringify({ type: 'auth', ...aliceAuth }))
			controlChannel.deliverInbound(JSON.stringify({ type: 'hello', ...aliceHello }))

			// 3) 握手应完成：ready resolve 且识别出对端 nodeHash。
			await Promise.race([
				link.ready,
				new Promise((_, reject) => setTimeout(() => reject(new Error('handshake did not complete (auth-before-hello regression)')), 3000)),
			])
			assertEquals(link.nodeHash, aliceNodeHash)
		}
		finally {
			await link.close('test-done')
		}
	},
})

/**
 * 轮询直到取到非空值或超时。
 * @param {() => T | null | undefined} probe 探测函数
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<T>} 探测结果
 * @template T
 */
async function pollFor(probe, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = probe()
		if (value) return value
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	throw new Error('pollFor timeout')
}
