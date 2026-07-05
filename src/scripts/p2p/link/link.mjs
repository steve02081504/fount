import { createLruMap } from '../../memo.mjs'
import { ms } from '../../ms.mjs'
import { compareHex64Asc, normalizeHex64 } from '../hexIds.mjs'
import { getSignalingRuntimeConfig } from '../node/instance.mjs'

import {
	CHANNEL_BULK,
	CHANNEL_CONTROL,
	CHANNEL_LOW_THRESHOLD_BYTES,
	configureBufferedAmountLowThreshold,
	createChannelSendQueues,
	onBufferedAmountLow,
} from './channel_mux.mjs'
import { createReassembler, encodeFrames, randomMsgIdHex } from './frame.mjs'
import { buildAuth, buildHello, parseHello, verifyAuth } from './handshake.mjs'
import { attachDataChannelListener, attachIceCandidateListener, loadNodeRtcPolyfill, signalDataToBytes, waitForChannelState } from './rtc.mjs'
import { extractDtlsFingerprint } from './sdp_fingerprint.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * 双 initiator 冲突时，nodeHash 较大的一方应主动关闭连接。
 * @param {unknown} left 第一个 nodeHash
 * @param {unknown} right 第二个 nodeHash
 * @returns {boolean} 若 left 应关闭则 true
 */
export function shouldCloseOwnInitiated(left, right) {
	return compareHex64Asc(normalizeHex64(left), normalizeHex64(right)) > 0
}

/**
 * 尝试将 channel 消息数据转为 UTF-8 字符串。
 * @param {unknown} data 原始消息数据
 * @returns {string | null} 解码后的字符串，无法解码时返回 null
 */
function coerceString(data) {
	if (typeof data === 'string') return data
	if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Uint8Array) 
		try { return decoder.decode(signalDataToBytes(data)) }
		catch { return null }
	
	return null
}

/**
 * 绑定 data channel message 回调，兼容 addEventListener/onmessage/onMessage。
 * @param {RTCDataChannel} channel RTC 数据通道
 * @param {(data: unknown) => void} handler 消息处理器
 * @returns {void}
 */
function attachChannelMessageListener(channel, handler) {
	channel.addEventListener?.('message', event => handler(event?.data))
	/**
	 * onmessage 回退处理器。
	 * @param {MessageEvent} event 消息事件
	 * @returns {void}
	 */
	channel.onmessage = event => handler(event?.data)
	channel.onMessage?.subscribe(message => handler(message))
}

/**
 * 依次调用监听器集合，忽略单个 listener 抛错。
 * @param {Set<Function>} listeners 监听器集合
 * @param {...unknown} args 传递给 listener 的参数
 * @returns {void}
 */
function emitListeners(listeners, ...args) {
	for (const listener of listeners)
		try { listener(...args) }
		catch { /* ignore */ }
}

/**
 * 将错误对象格式化为短字符串，用于 close reason。
 * @param {unknown} error 原始错误
 * @returns {string} 最多 240 字符的单行 reason
 */
function formatErrorReason(error) {
	return String(error?.message ?? error ?? 'unknown-error').replace(/\s+/g, ' ').slice(0, 240)
}

/**
 * 建立 P2P link：WebRTC 双通道、握手、分帧收发与心跳。
 * @param {object} opts link 配置
 * @param {string | null} [opts.nodeHash] 期望的对端 nodeHash，省略则不校验
 * @param {boolean} opts.initiator 是否为连接发起方
 * @param {{ send: (message: unknown) => void | Promise<void>, onRemote: (handler: (message: unknown) => void) => (() => void) | void }} opts.signal 信令收发接口
 * @param {RTCConfiguration['iceServers']} [opts.iceServers] ICE 服务器列表
 * @param {number} [opts.heartbeatMs] 心跳间隔（毫秒）
 * @param {number} [opts.idleTimeoutMs] 无入站流量超时（毫秒）
 * @param {number} [opts.handshakeTimeoutMs] 握手超时（毫秒）
 * @param {{ RTCPeerConnection: typeof RTCPeerConnection } | null} [opts.rtc] RTC 构造器，省略则加载 polyfill
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array, nonce?: string } | null} [opts.localIdentity] 本地握手身份
 * @returns {Promise<{ ready: Promise<void>, get nodeHash(): string | null, send: (envelope: { scope: string, action: string, payload: unknown }) => Promise<boolean>, onEnvelope: (cb: (envelope: { scope: string, action: string, payload: unknown }, remoteNodeHash: string) => void) => () => void, onDown: (cb: (reason: string) => void) => () => void, close: (reason?: string) => Promise<void>, stats: () => object }>} link 句柄
 */
export async function createLink(opts) {
	const heartbeatMs = Number(opts.heartbeatMs) || ms('15s')
	const idleTimeoutMs = Number(opts.idleTimeoutMs) || ms('45s')
	const handshakeTimeoutMs = Number(opts.handshakeTimeoutMs) || ms('10s')
	const channelOpenTimeoutMs = Math.max(handshakeTimeoutMs, ms('30s'))
	const trickleIceOff = getSignalingRuntimeConfig().trickleIceOff === true
	const rtc = opts.rtc ?? await loadNodeRtcPolyfill()
	const pc = new rtc.RTCPeerConnection(opts.iceServers?.length ? { iceServers: opts.iceServers } : undefined)
	const targetNodeHash = normalizeHex64(opts.nodeHash || '')
	const remoteSignalQueue = []
	const seenRemoteSignals = createLruMap(1024)
	let remoteDescriptionSet = false
	let closed = false
	let ready = false
	let closeReason = 'closed'
	let remoteNodeHash = targetNodeHash || null
	let remoteHello = null
	let localHello = null
	let controlChannel = null
	let bulkChannel = null
	let handshakeTimer = null
	let idleTimer = null
	let heartbeatTimer = null
	let unlistenRemote = null
	let helloSent = false
	let authSent = false
	let remoteAuthVerified = false
	let lastInboundAt = Date.now()
	let lastOutboundAt = 0
	let sentFrames = 0
	let recvFrames = 0
	let reconnectCount = 0
	let controlLowEvents = 0
	let bulkLowEvents = 0
	const envelopeListeners = new Set()
	const downListeners = new Set()
	const completedMsgIds = createLruMap(4096)
	const reassembler = createReassembler()
	let sendQueues = null
	/** @type {(value: void | PromiseLike<void>) => void} */
	let resolveReady
	/** @type {(reason?: unknown) => void} */
	let rejectReady
	const readyPromise = new Promise((resolve, reject) => {
		resolveReady = resolve
		rejectReady = reject
	})
	void readyPromise.catch(() => {})

	/**
	 * 经信令通道发送消息。
	 * @param {unknown} message 信令载荷
	 * @returns {Promise<void>}
	 */
	async function sendSignal(message) {
		await Promise.resolve(opts.signal.send(message))
	}

	/**
	 * 从本地 SDP 提取 DTLS fingerprint。
	 * @returns {string | null} 本地 fingerprint，未就绪时返回 null
	 */
	function localFingerprint() {
		return extractDtlsFingerprint(pc.localDescription?.sdp || '')
	}

	/**
	 * 从远端 SDP 提取 DTLS fingerprint。
	 * @returns {string | null} 远端 fingerprint，未就绪时返回 null
	 */
	function remoteFingerprint() {
		return extractDtlsFingerprint(pc.remoteDescription?.sdp || '')
	}

	/**
	 * 为通道配置背压泵：低水位时 flush 发送队列。
	 * @param {RTCDataChannel} channel RTC 数据通道
	 * @returns {void}
	 */
	function attachBackpressurePump(channel) {
		configureBufferedAmountLowThreshold(channel, CHANNEL_LOW_THRESHOLD_BYTES)
		onBufferedAmountLow(channel, () => {
			if (channel.label === CHANNEL_CONTROL) controlLowEvents++
			if (channel.label === CHANNEL_BULK) bulkLowEvents++
			if (channel.label === CHANNEL_CONTROL) sendQueues?.flush(CHANNEL_CONTROL)
			if (channel.label === CHANNEL_BULK) sendQueues?.flush(CHANNEL_BULK)
		})
	}

	/**
	 * 收到远端 hello 后发送 auth 签名。
	 * @returns {Promise<void>}
	 */
	async function maybeSendAuth() {
		if (authSent || !remoteHello) return
		const fingerprint = localFingerprint()
		if (!fingerprint) return
		authSent = true
		await sendRawControl(await buildAuth(remoteHello.nonce, fingerprint, opts.localIdentity ?? {}))
	}

	/**
	 * 握手完成后启动心跳/idle 检测并 resolve ready。
	 * @returns {Promise<void>}
	 */
	async function maybeFinishHandshake() {
		if (ready || !remoteHello || !remoteAuthVerified) return
		ready = true
		clearTimeout(handshakeTimer)
		heartbeatTimer = setInterval(() => {
			void send({ scope: 'link', action: 'ping', payload: {} }).catch(() => {})
		}, heartbeatMs)
		idleTimer = setInterval(() => {
			if (Date.now() - lastInboundAt > idleTimeoutMs)
				void close('idle-timeout')
		}, Math.max(1000, Math.floor(heartbeatMs / 3)))
		resolveReady()
	}

	/**
	 * 绑定分帧入站：JSON 控制消息或二进制帧重组为 envelope。
	 * @param {RTCDataChannel} channel RTC 数据通道
	 * @returns {void}
	 */
	function attachFramedIngress(channel) {
		attachChannelMessageListener(channel, data => {
			lastInboundAt = Date.now()
			const maybeText = coerceString(data)
			if (maybeText && maybeText.startsWith('{')) 
				try {
					const parsed = JSON.parse(maybeText)
					void handleRawControlMessage(parsed)
					return
				}
				catch {
					/* fall through to binary path */
				}
			
			let bytes
			try {
				bytes = signalDataToBytes(data)
			}
			catch {
				return
			}
			try {
				recvFrames++
				const merged = reassembler.push(bytes)
				if (!merged) return
				const envelope = JSON.parse(decoder.decode(merged))
				const msgId = envelope?.msgId ? String(envelope.msgId) : null
				if (msgId && completedMsgIds.has(msgId)) return
				if (msgId) completedMsgIds.touch(msgId, true)
				if (envelope?.scope === 'link') {
					if (envelope.action === 'ping') {
						void send({ scope: 'link', action: 'pong', payload: {} }).catch(() => {})
						return
					}
					if (envelope.action === 'pong') return
				}
				if (ready && remoteNodeHash)
					emitListeners(envelopeListeners, envelope, remoteNodeHash)
			}
			catch {
				/* drop malformed network ingress */
			}
		})
	}

	/**
	 * 验证远端 auth 并完成握手。
	 * @param {{ sig: string }} auth 远端 auth 载荷
	 * @returns {Promise<void>}
	 */
	async function handleAuth(auth) {
		if (!remoteHello) return
		const fingerprint = remoteFingerprint()
		const verifiedNodeHash = await verifyAuth(remoteHello, auth, localHello?.nonce, fingerprint)
		if (!verifiedNodeHash) {
			await close(`auth-failed:fingerprint=${fingerprint || 'missing'} localNonce=${localHello?.nonce || 'missing'}`)
			return
		}
		if (targetNodeHash && verifiedNodeHash !== targetNodeHash) {
			await close('nodehash-mismatch')
			return
		}
		remoteNodeHash = verifiedNodeHash
		remoteAuthVerified = true
		await maybeFinishHandshake()
	}

	/**
	 * 处理 control 通道上的 JSON hello/auth 消息。
	 * @param {unknown} message 原始 JSON 对象
	 * @returns {Promise<void>}
	 */
	async function handleRawControlMessage(message) {
		if (!message || typeof message !== 'object') return
		if (message.type === 'hello') {
			const parsed = parseHello(message)
			if (!parsed) {
				await close('hello-invalid')
				return
			}
			remoteHello = parsed
			await maybeSendAuth()
			return
		}
		if (message.type === 'auth') 
			await handleAuth(message)
		
	}

	/**
	 * 应用远端 SDP 并 flush 排队的 ICE candidate。
	 * @param {RTCSessionDescriptionInit | RTCSessionDescription} description 远端会话描述
	 * @returns {Promise<void>}
	 */
	async function applyRemoteDescription(description) {
		await pc.setRemoteDescription(description)
		remoteDescriptionSet = true
		await flushQueuedIceCandidates()
	}

	/**
	 * 判断 ICE 错误是否应重试排队 candidate。
	 * @param {unknown} error addIceCandidate 抛出的错误
	 * @returns {boolean} 应重新入队则 true
	 */
	function shouldRetryQueuedIce(error) {
		return /without ICE transport/i.test(String(error?.message ?? error ?? ''))
	}

	/**
	 * trickle ICE 关闭时等待 ICE gathering 完成。
	 * @returns {Promise<void>}
	 */
	async function waitForIceGatheringComplete() {
		if (!trickleIceOff || pc.iceGatheringState === 'complete') return
		const deadline = Date.now() + handshakeTimeoutMs
		while (pc.iceGatheringState !== 'complete' && !closed && Date.now() < deadline)
			await new Promise(resolve => setTimeout(resolve, 50))
	}

	/**
	 * 将排队的远端 ICE candidate 依次加入 PeerConnection。
	 * @returns {Promise<void>}
	 */
	async function flushQueuedIceCandidates() {
		if (!remoteDescriptionSet || !pc.localDescription) return
		while (remoteSignalQueue.length) {
			const candidate = remoteSignalQueue.shift()
			try {
				await pc.addIceCandidate(candidate)
			}
			catch (error) {
				if (shouldRetryQueuedIce(error)) {
					remoteSignalQueue.unshift(candidate)
					return
				}
				throw error
			}
		}
	}

	/**
	 * 处理远端信令：SDP description 与 ICE candidate。
	 * @param {unknown} message 信令消息对象
	 * @returns {Promise<void>}
	 */
	async function handleRemoteSignal(message) {
		if (closed || !message || typeof message !== 'object') return
		const signalKey = JSON.stringify(message)
		if (seenRemoteSignals.has(signalKey)) return
		seenRemoteSignals.touch(signalKey, true)
		if (message.type === 'description' && message.description) {
			if (message.description.type === 'answer' && pc.signalingState === 'stable') return
			await applyRemoteDescription(message.description)
			if (message.description.type === 'offer') {
				const answer = await pc.createAnswer()
				await pc.setLocalDescription(answer)
				await flushQueuedIceCandidates()
				await waitForIceGatheringComplete()
				await sendSignal({
					type: 'description',
					description: pc.localDescription?.toJSON?.() ?? pc.localDescription ?? answer,
				})
				await maybeSendAuth()
			}
			return
		}
		if (message.type === 'ice' && message.candidate) {
			if (!remoteDescriptionSet || !pc.localDescription || pc.signalingState !== 'stable') {
				remoteSignalQueue.push(message.candidate)
				return
			}
			try {
				await pc.addIceCandidate(message.candidate)
			}
			catch (error) {
				if (shouldRetryQueuedIce(error)) {
					remoteSignalQueue.push(message.candidate)
					return
				}
				throw error
			}
		}
	}

	/**
	 * 绑定 data channel 并配置入站/背压。
	 * @param {RTCDataChannel} channel RTC 数据通道
	 * @returns {Promise<void>}
	 */
	async function attachChannel(channel) {
		if (channel.label === CHANNEL_CONTROL) {
			controlChannel = channel
			attachFramedIngress(channel)
			attachBackpressurePump(channel)
		}
		if (channel.label === CHANNEL_BULK) {
			bulkChannel = channel
			attachFramedIngress(channel)
			attachBackpressurePump(channel)
		}
	}

	/**
	 * 双通道就绪后初始化发送队列并发送 hello。
	 * @returns {Promise<void>}
	 */
	async function maybeStartPostOpenFlow() {
		if (!controlChannel || !bulkChannel) return
		await Promise.all([
			waitForChannelState(controlChannel, 'open', channelOpenTimeoutMs),
			waitForChannelState(bulkChannel, 'open', channelOpenTimeoutMs),
		])
		if (!sendQueues) 
			sendQueues = createChannelSendQueues({
				/**
				 * 按名称返回 control 或 bulk 通道。
				 * @param {'control' | 'bulk'} name 通道名
				 * @returns {RTCDataChannel | null | undefined} 对应通道实例
				 */
				getChannel: name => name === CHANNEL_CONTROL ? controlChannel : bulkChannel,
			})
		
		if (!helloSent) {
			handshakeTimer = setTimeout(() => { void close('handshake-timeout') }, handshakeTimeoutMs)
			helloSent = true
			localHello = buildHello(opts.localIdentity ?? {})
			await sendRawControl(localHello)
		}
		await maybeSendAuth()
	}

	/**
	 * 经 control 通道发送 JSON hello/auth。
	 * @param {object} body hello 或 auth 字段
	 * @returns {Promise<void>}
	 */
	async function sendRawControl(body) {
		if (!controlChannel) throw new Error('p2p: control channel unavailable')
		controlChannel.send(JSON.stringify({ type: body.sig ? 'auth' : 'hello', ...body }))
		lastOutboundAt = Date.now()
	}

	/**
	 * 发送 envelope：分帧后经发送队列发出。
	 * @param {{ scope: string, action: string, payload: unknown }} envelope 业务信封
	 * @returns {Promise<boolean>} 发送成功 true，link 未就绪或已关闭 false
	 */
	async function send(envelope) {
		await readyPromise
		if (closed || !sendQueues) return false
		const message = {
			scope: String(envelope?.scope || ''),
			action: String(envelope?.action || ''),
			payload: envelope?.payload ?? null,
			msgId: randomMsgIdHex(),
		}
		const bytes = encoder.encode(JSON.stringify(message))
		for (const frame of encodeFrames(message.msgId, bytes)) {
			sendQueues.enqueue(message.action, frame)
			sentFrames++
		}
		lastOutboundAt = Date.now()
		return true
	}

	/**
	 * 关闭 link 并清理资源。
	 * @param {string} [reason='closed'] 关闭原因
	 * @returns {Promise<void>}
	 */
	async function close(reason = 'closed') {
		if (closed) return
		closed = true
		closeReason = reason
		clearTimeout(handshakeTimer)
		if (heartbeatTimer) clearInterval(heartbeatTimer)
		if (idleTimer) clearInterval(idleTimer)
		unlistenRemote?.()
		sendQueues?.clear()
		try { controlChannel?.close() } catch { /* ignore */ }
		try { bulkChannel?.close() } catch { /* ignore */ }
		try { await pc.close() } catch { /* ignore */ }
		if (!ready) rejectReady(new Error(`p2p: link closed before ready (${reason})`))
		emitListeners(downListeners, reason)
	}

	unlistenRemote = opts.signal.onRemote(message => {
		void handleRemoteSignal(message).catch(error => close(`signal-error:${formatErrorReason(error)}`))
	}) ?? null

	attachIceCandidateListener(pc, event => {
		if (trickleIceOff || !event.candidate) return
		void sendSignal({
			type: 'ice',
			candidate: typeof event.candidate.toJSON === 'function' ? event.candidate.toJSON() : event.candidate,
		}).catch(error => close(`signal-send-failed:${formatErrorReason(error)}`))
	})
	attachDataChannelListener(pc, event => {
		void attachChannel(event.channel)
			.then(() => maybeStartPostOpenFlow())
			.catch(error => close(`channel-attach-failed:${error?.message ?? error}`))
	})

	/**
	 * PeerConnection 状态变化时触发 close。
	 * @returns {void}
	 */
	pc.onconnectionstatechange = () => {
		if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
			reconnectCount++
			void close(`connection-${pc.connectionState}`)
		}
	}

	if (opts.initiator) {
		await attachChannel(pc.createDataChannel(CHANNEL_CONTROL))
		await attachChannel(pc.createDataChannel(CHANNEL_BULK))
		const offer = await pc.createOffer()
		await pc.setLocalDescription(offer)
		await waitForIceGatheringComplete()
		await sendSignal({
			type: 'description',
			description: pc.localDescription?.toJSON?.() ?? pc.localDescription ?? offer,
		})
	}

	void maybeStartPostOpenFlow().catch(error => close(`open-flow-failed:${error?.message ?? error}`))
	return {
		ready: readyPromise,
		/**
		 * 握手完成后确认的远端 nodeHash。
		 * @returns {string | null} 远端 nodeHash
		 */
		get nodeHash() { return remoteNodeHash },
		/**
		 * 本端是否为连接发起方。
		 * @returns {boolean} initiator 标志
		 */
		get initiator() { return !!opts.initiator },
		send,
		/**
		 * 订阅业务 envelope 入站。
		 * @param {(envelope: { scope: string, action: string, payload: unknown }, remoteNodeHash: string) => void} cb 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onEnvelope(cb) {
			envelopeListeners.add(cb)
			return () => envelopeListeners.delete(cb)
		},
		/**
		 * 订阅 link 断开事件。
		 * @param {(reason: string) => void} cb 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onDown(cb) {
			downListeners.add(cb)
			return () => downListeners.delete(cb)
		},
		close,
		/**
		 * 按名称获取底层 data channel（调试用）。
		 * @param {'control' | 'bulk'} name 通道名
		 * @returns {RTCDataChannel | null} 通道实例
		 */
		channel(name) {
			return name === CHANNEL_CONTROL ? controlChannel : bulkChannel
		},
		/**
		 * 返回 link 运行时统计快照。
		 * @returns {object} 连接状态、计数与缓冲信息
		 */
		stats() {
			return {
				ready,
				nodeHash: remoteNodeHash,
				targetNodeHash: targetNodeHash || null,
				initiator: !!opts.initiator,
				connectionState: pc.connectionState,
				iceConnectionState: pc.iceConnectionState,
				lastInboundAt,
				lastOutboundAt,
				sentFrames,
				recvFrames,
				closeReason,
				reconnectCount,
				pending: sendQueues?.pending() ?? { control: 0, bulk: 0 },
				controlBufferedAmount: controlChannel?.bufferedAmount ?? 0,
				bulkBufferedAmount: bulkChannel?.bufferedAmount ?? 0,
				controlLowEvents,
				bulkLowEvents,
			}
		},
	}
}
