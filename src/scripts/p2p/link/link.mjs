import { ms } from '../../ms.mjs'
import { createLruMap } from '../../memo.mjs'
import { compareHex64Asc, normalizeHex64 } from '../hexIds.mjs'
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
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function shouldCloseOwnInitiated(left, right) {
	return compareHex64Asc(normalizeHex64(left), normalizeHex64(right)) > 0
}

/**
 * @param {unknown} data
 * @returns {string | null}
 */
function coerceString(data) {
	if (typeof data === 'string') return data
	if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Uint8Array) {
		try { return decoder.decode(signalDataToBytes(data)) }
		catch { return null }
	}
	return null
}

/**
 * @param {RTCDataChannel} channel
 * @param {(data: unknown) => void} handler
 * @returns {void}
 */
function attachChannelMessageListener(channel, handler) {
	channel.addEventListener?.('message', event => handler(event?.data))
	channel.onmessage = event => handler(event?.data)
	channel.onMessage?.subscribe(message => handler(message))
}

/**
 * @param {Set<Function>} listeners
 * @param {...unknown} args
 * @returns {void}
 */
function emitListeners(listeners, ...args) {
	for (const listener of listeners)
		try { listener(...args) }
		catch { /* ignore */ }
}

/**
 * @param {object} opts
 * @param {string | null} [opts.nodeHash]
 * @param {boolean} opts.initiator
 * @param {{ send: (message: unknown) => void | Promise<void>, onRemote: (handler: (message: unknown) => void) => (() => void) | void }} opts.signal
 * @param {RTCConfiguration['iceServers']} [opts.iceServers]
 * @param {number} [opts.heartbeatMs]
 * @param {number} [opts.idleTimeoutMs]
 * @param {number} [opts.handshakeTimeoutMs]
 * @param {{ RTCPeerConnection: typeof RTCPeerConnection } | null} [opts.rtc]
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array, nonce?: string } | null} [opts.localIdentity]
 * @returns {Promise<{ ready: Promise<void>, get nodeHash(): string | null, send: (envelope: { scope: string, action: string, payload: unknown }) => Promise<boolean>, onEnvelope: (cb: (envelope: { scope: string, action: string, payload: unknown }, remoteNodeHash: string) => void) => () => void, onDown: (cb: (reason: string) => void) => () => void, close: (reason?: string) => Promise<void>, stats: () => object }>}
 */
export async function createLink(opts) {
	const heartbeatMs = Number(opts.heartbeatMs) || ms('15s')
	const idleTimeoutMs = Number(opts.idleTimeoutMs) || ms('45s')
	const handshakeTimeoutMs = Number(opts.handshakeTimeoutMs) || ms('10s')
	const channelOpenTimeoutMs = Math.max(handshakeTimeoutMs, ms('30s'))
	const rtc = opts.rtc ?? await loadNodeRtcPolyfill()
	const pc = new rtc.RTCPeerConnection(opts.iceServers?.length ? { iceServers: opts.iceServers } : undefined)
	const targetNodeHash = normalizeHex64(opts.nodeHash || '')
	const remoteSignalQueue = []
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

	/**
	 * @param {unknown} message
	 * @returns {Promise<void>}
	 */
	async function sendSignal(message) {
		await Promise.resolve(opts.signal.send(message))
	}

	/**
	 * @returns {string | null}
	 */
	function localFingerprint() {
		return extractDtlsFingerprint(pc.localDescription?.sdp || '')
	}

	/**
	 * @returns {string | null}
	 */
	function remoteFingerprint() {
		return extractDtlsFingerprint(pc.remoteDescription?.sdp || '')
	}

	/**
	 * @param {RTCDataChannel} channel
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
	 * @param {RTCDataChannel} channel
	 * @returns {void}
	 */
	function attachFramedIngress(channel) {
		attachChannelMessageListener(channel, data => {
			lastInboundAt = Date.now()
			const maybeText = coerceString(data)
			if (maybeText && maybeText.startsWith('{')) {
				try {
					const parsed = JSON.parse(maybeText)
					void handleRawControlMessage(parsed)
					return
				}
				catch {
					/* fall through to binary path */
				}
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
	 * @param {{ sig: string }} auth
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
	 * @param {unknown} message
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
		if (message.type === 'auth') {
			await handleAuth(message)
		}
	}

	/**
	 * @param {RTCSessionDescriptionInit | RTCSessionDescription} description
	 * @returns {Promise<void>}
	 */
	async function applyRemoteDescription(description) {
		await pc.setRemoteDescription(description)
		remoteDescriptionSet = true
		while (remoteSignalQueue.length)
			await pc.addIceCandidate(remoteSignalQueue.shift())
	}

	/**
	 * @param {unknown} message
	 * @returns {Promise<void>}
	 */
	async function handleRemoteSignal(message) {
		if (closed || !message || typeof message !== 'object') return
		if (message.type === 'description' && message.description) {
			await applyRemoteDescription(message.description)
			if (message.description.type === 'offer') {
				const answer = await pc.createAnswer()
				await pc.setLocalDescription(answer)
				await sendSignal({ type: 'description', description: answer?.toJSON?.() ?? answer })
				await maybeSendAuth()
			}
			return
		}
		if (message.type === 'ice' && message.candidate) {
			if (!remoteDescriptionSet) {
				remoteSignalQueue.push(message.candidate)
				return
			}
			await pc.addIceCandidate(message.candidate)
		}
	}

	/**
	 * @param {RTCDataChannel} channel
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
	 * @returns {Promise<void>}
	 */
	async function maybeStartPostOpenFlow() {
		if (!controlChannel || !bulkChannel) return
		await Promise.all([
			waitForChannelState(controlChannel, 'open', channelOpenTimeoutMs),
			waitForChannelState(bulkChannel, 'open', channelOpenTimeoutMs),
		])
		if (!sendQueues) {
			sendQueues = createChannelSendQueues({
				getChannel: name => name === CHANNEL_CONTROL ? controlChannel : bulkChannel,
			})
		}
		if (!helloSent) {
			handshakeTimer = setTimeout(() => { void close('handshake-timeout') }, handshakeTimeoutMs)
			helloSent = true
			localHello = buildHello(opts.localIdentity ?? {})
			await sendRawControl(localHello)
		}
		await maybeSendAuth()
	}

	/**
	 * @param {object} body
	 * @returns {Promise<void>}
	 */
	async function sendRawControl(body) {
		if (!controlChannel) throw new Error('p2p: control channel unavailable')
		controlChannel.send(JSON.stringify({ type: body.sig ? 'auth' : 'hello', ...body }))
		lastOutboundAt = Date.now()
	}

	/**
	 * @param {{ scope: string, action: string, payload: unknown }} envelope
	 * @returns {Promise<boolean>}
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
	 * @param {string} [reason='closed']
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
		void handleRemoteSignal(message).catch(() => close('signal-error'))
	}) ?? null

	attachIceCandidateListener(pc, event => {
		if (!event.candidate) return
		void sendSignal({
			type: 'ice',
			candidate: typeof event.candidate.toJSON === 'function' ? event.candidate.toJSON() : event.candidate,
		}).catch(() => close('signal-send-failed'))
	})
	attachDataChannelListener(pc, event => {
		void attachChannel(event.channel)
			.then(() => maybeStartPostOpenFlow())
			.catch(error => close(`channel-attach-failed:${error?.message ?? error}`))
	})

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
		await sendSignal({ type: 'description', description: offer?.toJSON?.() ?? offer })
	}

	void maybeStartPostOpenFlow().catch(error => close(`open-flow-failed:${error?.message ?? error}`))
	return {
		ready: readyPromise,
		get nodeHash() { return remoteNodeHash },
		get initiator() { return !!opts.initiator },
		send,
		onEnvelope(cb) {
			envelopeListeners.add(cb)
			return () => envelopeListeners.delete(cb)
		},
		onDown(cb) {
			downListeners.add(cb)
			return () => downListeners.delete(cb)
		},
		close,
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
