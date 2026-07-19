/**
 * 【文件】public/shared/avRelayClient.mjs
 * 【职责】WebCodecs + AV relay 精简客户端（推流 / 解码播画）；导出帧协议工具。Social live 复用 joinAvRelayRoom。
 * 【原理】26 字节帧头与 chat `avRelay.mjs` 一致；支持 av/audio/video 模式、publish_meta 协商、VAD 门限。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-param-type, jsdoc/require-returns, jsdoc/require-returns-description */
/* global VideoEncoder VideoDecoder EncodedVideoChunk VideoFrame MediaStreamTrackProcessor AudioEncoder AudioDecoder EncodedAudioChunk AudioData */

import { buildWebSocketUrl } from '../src/wsUrl.mjs'

import { createAudioGate } from './audioGate.mjs'
import { CODECS_PRESETS } from './avRelayPresets.mjs'
import { bytesToHex } from './digest.mjs'

export { bytesToHex }

const PRESET = CODECS_PRESETS.med
/** 帧类型：摄像头视频 */
export const FRAME_VIDEO = 0
/** 帧类型：音频 */
export const FRAME_AUDIO = 1
/** 帧类型：屏幕共享 */
export const FRAME_SCREEN = 2
/** relay 帧头字节数（与服务端 avRelay 一致） */
export const FRAME_HEADER_BYTES = 26
const KEY_MS = 2000
/**
 *
 */
export const AUDIO_CODEC = 'opus'
/**
 *
 */
export const AUDIO_SAMPLE_RATE = 48_000
/**
 *
 */
export const AUDIO_CHANNELS = 1
/**
 *
 */
export const AUDIO_BPS = 32_000

/**
 * @typedef {object} AvRelaySession
 * @property {() => void} close
 * @property {() => boolean} toggleMute
 * @property {() => boolean} toggleVideo
 * @property {(mode: 'full' | 'preview') => void} [setMode]
 * @property {() => 'full' | 'preview'} [getMode]
 * @property {(senderId?: string) => number[]} [getAudioLevels]
 * @property {() => object | null} [getLocalPublishMeta]
 */

/**
 * @param {{ close?: () => unknown } | null | undefined} resource
 * @returns {void}
 */
export function safeClose(resource) {
	try {
		const closing = resource?.close?.()
		void closing?.catch?.(() => {})
	}
	catch { /* ignore */ }
}

/**
 *
 * @param roomId
 */
export function buildChatAvRelayWsUrl(roomId) {
	return buildWebSocketUrl(`/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}`)
}

/**
 *
 * @param groupId
 * @param channelId
 */
export function buildChatCallWsUrl(groupId, channelId) {
	return buildWebSocketUrl(
		`/ws/parts/shells:chat/call/${encodeURIComponent(groupId)}/${encodeURIComponent(channelId)}`,
	)
}

/**
 *
 * @param frameType
 * @param isKey
 * @param data
 * @param selfId
 * @param t0
 * @param seqRef
 */
export function packAvFrame(frameType, isKey, data, selfId, t0, seqRef) {
	const out = new Uint8Array(FRAME_HEADER_BYTES + data.byteLength)
	const dv = new DataView(out.buffer)
	dv.setUint8(0, frameType)
	dv.setUint8(1, isKey ? 1 : 0)
	dv.setUint32(2, seqRef.seq++, false)
	dv.setUint32(6, (performance.now() - t0) | 0, false)
	out.set(selfId, 10)
	out.set(data, FRAME_HEADER_BYTES)
	return out.buffer
}

/**
 *
 * @param buf
 */
export function unpackAvFrame(buf) {
	if (buf.byteLength < FRAME_HEADER_BYTES) return null
	const view = new DataView(buf)
	return {
		frameType: view.getUint8(0),
		isKey: !!(view.getUint8(1) & 1),
		sender: bytesToHex(new Uint8Array(buf, 10, 16)),
		data: buf.slice(FRAME_HEADER_BYTES),
	}
}

/**
 * @param {object | null | undefined} videoMeta
 * @returns {string}
 */
function videoCodecString(videoMeta) {
	if (!videoMeta) return PRESET.codec
	const c = String(videoMeta.codec || '').toLowerCase()
	if (c === 'avc' || c === 'h264') return 'avc1.42E01E'
	return PRESET.codec
}

/**
 * @param {object} options
 * @returns {Promise<AvRelaySession>}
 */
export async function joinAvRelayRoom(options) {
	const {
		wsUrl,
		onBinaryFrame,
		onPeerCount,
		onPublishMeta,
		asPublisher = false,
		canvas = null,
		videoLocal = null,
		voiceRingHost = null,
		mode: initialMode = 'full',
		media: mediaMode = 'av',
	} = options

	const wantsVideo = mediaMode !== 'audio'
	const wantsAudio = mediaMode !== 'video'

	if (asPublisher && wantsVideo && (!('VideoEncoder' in globalThis) || !('AudioEncoder' in globalThis) && wantsAudio))
		throw new Error('WebCodecs not supported')
	if (!asPublisher && wantsVideo && !('VideoDecoder' in globalThis))
		throw new Error('WebCodecs not supported')
	if (!asPublisher && initialMode !== 'preview' && wantsAudio && !('AudioDecoder' in globalThis))
		throw new Error('WebCodecs not supported')

	const selfId = crypto.getRandomValues(new Uint8Array(16))
	const selfHex = bytesToHex(selfId)
	const t0 = performance.now()
	const videoSeq = { seq: 0 }
	const audioSeq = { seq: 0 }
	let mode = initialMode === 'preview' ? 'preview' : 'full'

	/** @type {Map<string, object | null>} */
	const remoteMeta = new Map()
	/** @type {Map<string, { analyser: AnalyserNode | null, levels: number[] }>} */
	const audioLevels = new Map()

	const ws = new WebSocket(wsUrl)
	ws.binaryType = 'arraybuffer'

	/** @type {VideoDecoder | null} */
	let videoDecoder = null
	let videoMeta = null
	/** @type {AudioDecoder | null} */
	let audioDecoder = null
	/** @type {AudioContext | null} */
	let audioCtx = null
	let videoHasKey = false
	let audioHasKey = false
	let videoRx = 0
	let audioRx = 0
	let audioNextTime = 0
	let remoteSender = ''

	/**
	 *
	 */
	const sendPublishMeta = () => {
		if (!asPublisher || ws.readyState !== WebSocket.OPEN) return
		const meta = {
			type: 'publish_meta',
			senderId: selfHex,
			video: wantsVideo ? { codec: PRESET.codec.replace('vp08', 'vp8'), w: PRESET.w, h: PRESET.h } : null,
			audio: wantsAudio ? { codec: AUDIO_CODEC } : null,
		}
		ws.send(JSON.stringify(meta))
	}

	/**
	 *
	 * @param sender
	 * @param meta
	 */
	const ensureVideoDecoder = (sender, meta) => {
		if (!canvas || videoDecoder) return
		const codec = videoCodecString(meta?.video)
		const w = meta?.video?.w || PRESET.w
		const h = meta?.video?.h || PRESET.h
		const ctx2d = canvas.getContext('2d')
		canvas.width = w
		canvas.height = h
		videoDecoder = new VideoDecoder({
			/**
			 *
			 * @param frame
			 */
			output: frame => {
				ctx2d.drawImage(frame, 0, 0, w, h)
				frame.close()
			},
			/**
			 *
			 * @param err
			 */
			error: err => console.error('VideoDecoder:', err),
		})
		videoDecoder.configure({ codec, codedWidth: w, codedHeight: h })
		videoMeta = meta
		remoteSender = sender
	}

	/**
	 *
	 */
	const ensureAudioDecoder = () => {
		if (audioDecoder || mode === 'preview') return
		audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
		audioDecoder = new AudioDecoder({
			/**
			 *
			 * @param audioData
			 */
			output: audioData => {
				const analyser = audioCtx.createAnalyser()
				analyser.fftSize = 256
				const gain = audioCtx.createGain()
				const src = audioCtx.createBufferSource()
				const buf = audioCtx.createBuffer(
					audioData.numberOfChannels,
					audioData.numberOfFrames,
					audioData.sampleRate,
				)
				for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
					const plane = new Float32Array(audioData.numberOfFrames)
					audioData.copyTo(plane, { planeIndex: ch })
					buf.copyToChannel(plane, ch)
				}
				src.buffer = buf
				src.connect(gain)
				gain.connect(analyser)
				analyser.connect(audioCtx.destination)
				const now = audioCtx.currentTime
				const start = Math.max(now, audioNextTime || now)
				src.start(start)
				audioNextTime = start + buf.duration
				const sid = remoteSender || 'default'
				const entry = audioLevels.get(sid) || { analyser: null, levels: [] }
				entry.analyser = analyser
				audioLevels.set(sid, entry)
				audioData.close()
			},
			/**
			 *
			 * @param err
			 */
			error: err => console.error('AudioDecoder:', err),
		})
		audioDecoder.configure({
			codec: AUDIO_CODEC,
			sampleRate: AUDIO_SAMPLE_RATE,
			numberOfChannels: AUDIO_CHANNELS,
		})
	}

	if (!asPublisher && canvas && wantsVideo) ensureVideoDecoder('', { video: { codec: PRESET.codec, w: PRESET.w, h: PRESET.h } })
	if (!asPublisher && wantsAudio && mode === 'full') ensureAudioDecoder()

	/**
	 *
	 * @param arrayBuffer
	 */
	const handleInbound = arrayBuffer => {
		onBinaryFrame?.(arrayBuffer)
		if (asPublisher) return
		const frame = unpackAvFrame(arrayBuffer)
		if (!frame || frame.sender === selfHex) return

		const meta = remoteMeta.get(frame.sender)
		if (frame.frameType === FRAME_AUDIO) {
			if (mode === 'preview' || !wantsAudio) return
			if (!audioDecoder) {
				remoteSender = frame.sender
				ensureAudioDecoder()
			}
			if (!frame.isKey && !audioHasKey) return
			if (frame.isKey) audioHasKey = true
			if (audioDecoder.decodeQueueSize > 8) return
			audioRx++
			audioDecoder.decode(new EncodedAudioChunk({
				type: frame.isKey ? 'key' : 'delta',
				timestamp: audioRx * 20_000,
				data: frame.data,
			}))
			return
		}

		if (!wantsVideo) return
		if (!videoDecoder && meta) ensureVideoDecoder(frame.sender, meta)
		if (!videoDecoder) return
		if (mode === 'preview' && !frame.isKey) return
		if (!frame.isKey && !videoHasKey) return
		if (frame.isKey) {
			videoHasKey = true
			if (mode === 'full') videoRx = 0
		}
		if (videoDecoder.decodeQueueSize > 10) return
		videoRx++
		const fps = meta?.video?.fps || PRESET.fps
		videoDecoder.decode(new EncodedVideoChunk({
			type: frame.isKey ? 'key' : 'delta',
			timestamp: videoRx * Math.round(1_000_000 / fps),
			data: frame.data,
		}))
	}

	/**
	 *
	 * @param event
	 */
	ws.onmessage = event => {
		if (event.data instanceof ArrayBuffer) {
			handleInbound(event.data)
			return
		}
		const controlFrame = JSON.parse(event.data)
		if (controlFrame.type === 'peer_count') onPeerCount?.(controlFrame.count)
		if (controlFrame.type === 'publish_meta') {
			const sid = String(controlFrame.senderId || '').toLowerCase()
			remoteMeta.set(sid, controlFrame)
			onPublishMeta?.(controlFrame)
			if (!asPublisher && !videoDecoder && canvas && controlFrame.video)
				ensureVideoDecoder(sid, controlFrame)
			if (!asPublisher && !audioDecoder && controlFrame.audio && mode === 'full')
				ensureAudioDecoder()
		}
		if (controlFrame.type === 'publish_meta_revoke') {
			const sid = String(controlFrame.senderId || '').toLowerCase()
			remoteMeta.delete(sid)
			audioLevels.delete(sid)
		}
	}

	await new Promise((res, rej) => {
		ws.onopen = res
		ws.onerror = rej
	})

	if (!asPublisher && ws.readyState === WebSocket.OPEN)
		ws.send(JSON.stringify({ type: 'subscribe', mode }))

	/** @type {MediaStream | null} */
	let mediaStream = null
	/**
	 *
	 */
	let stopCapture = () => { }
	let videoEnabled = wantsVideo
	let audioMuted = false
	const audioGate = createAudioGate()

	if (asPublisher)
		try {
			const constraints = {}
			if (wantsVideo)
				constraints.video = { width: PRESET.w, height: PRESET.h, frameRate: PRESET.fps }
			if (wantsAudio)
				constraints.audio = {
					echoCancellation: true,
					noiseSuppression: true,
					sampleRate: AUDIO_SAMPLE_RATE,
					channelCount: AUDIO_CHANNELS,
				}
			mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
			if (videoLocal && wantsVideo) {
				videoLocal.srcObject = mediaStream
				videoLocal.muted = true
			}

			stopCapture = await startPublish({
				mediaStream,
				ws,
				selfId,
				t0,
				videoSeq,
				audioSeq,
				wantsVideo,
				wantsAudio,
				audioGate,
				/**
				 *
				 */
				isVideoSending: () => videoEnabled && ws.readyState === WebSocket.OPEN,
				/**
				 *
				 */
				isAudioSending: () => !audioMuted && ws.readyState === WebSocket.OPEN,
			})
			sendPublishMeta()
		}
		catch (err) {
			ws.close()
			throw err
		}

	return {
		/**
		 *
		 */
		close: () => {
			stopCapture()
			mediaStream?.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
			safeClose(videoDecoder)
			safeClose(audioDecoder)
			safeClose(audioCtx)
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'publish_meta_revoke', senderId: selfHex }))
			ws.close()
		},
		/**
		 *
		 */
		toggleMute: () => {
			audioMuted = !audioMuted
			const track = mediaStream?.getAudioTracks()[0]
			if (track) track.enabled = !audioMuted
			return audioMuted
		},
		/**
		 *
		 */
		toggleVideo: () => {
			if (!wantsVideo) return true
			videoEnabled = !videoEnabled
			const track = mediaStream?.getVideoTracks()[0]
			if (track) track.enabled = videoEnabled
			return !videoEnabled
		},
		/**
		 *
		 * @param next
		 */
		setMode: next => {
			const target = next === 'preview' ? 'preview' : 'full'
			if (target === mode) return
			mode = target
			if (target === 'full') {
				if (wantsAudio) ensureAudioDecoder()
				videoHasKey = false
				audioHasKey = false
			}
			else {
				safeClose(audioDecoder)
				audioDecoder = null
				safeClose(audioCtx)
				audioCtx = null
				audioHasKey = false
			}
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'subscribe', mode }))
		},
		/**
		 *
		 */
		getMode: () => mode,
		/**
		 *
		 * @param senderId
		 */
		getAudioLevels: (senderId = '') => {
			const sid = String(senderId || remoteSender || 'default').toLowerCase()
			const entry = audioLevels.get(sid)
			if (entry?.analyser) {
				const data = new Uint8Array(entry.analyser.frequencyBinCount)
				entry.analyser.getByteFrequencyData(data)
				const bands = 16
				const out = []
				const step = Math.max(1, Math.floor(data.length / bands))
				for (let i = 0; i < bands; i++) {
					let sum = 0
					for (let j = i * step; j < (i + 1) * step && j < data.length; j++) sum += data[j]
					out.push((sum / step) / 255)
				}
				entry.levels = out
			}
			if (asPublisher) {
				const lvl = audioGate.getLevel()
				return Array.from({ length: 16 }, (_, i) => lvl * (0.6 + 0.4 * Math.sin(i)))
			}
			return entry?.levels?.length ? entry.levels : Array(16).fill(0.05)
		},
		/**
		 *
		 */
		getLocalPublishMeta: () => ({
			type: 'publish_meta',
			senderId: selfHex,
			video: wantsVideo ? { codec: 'vp8', w: PRESET.w, h: PRESET.h } : null,
			audio: wantsAudio ? { codec: AUDIO_CODEC } : null,
		}),
	}
}

/**
 * @param {object} options
 * @returns {Promise<() => void>}
 */
async function startPublish(options) {
	const {
		mediaStream: stream, ws, selfId, t0, videoSeq, audioSeq,
		wantsVideo, wantsAudio, audioGate,
		isVideoSending, isAudioSending,
	} = options

	const vTrack = wantsVideo ? stream.getVideoTracks()[0] : null
	const aTrack = wantsAudio ? stream.getAudioTracks()[0] : null

	/** @type {VideoEncoder | null} */
	let vEnc = null
	/** @type {() => void} */
	let stopVideo = () => { }

	if (vTrack && 'MediaStreamTrackProcessor' in globalThis) {
		vEnc = new VideoEncoder({
			/**
			 *
			 * @param chunk
			 */
			output: chunk => {
				if (!isVideoSending()) return
				const raw = new Uint8Array(chunk.byteLength)
				chunk.copyTo(raw)
				ws.send(packAvFrame(FRAME_VIDEO, chunk.type === 'key', raw, selfId, t0, videoSeq))
			},
			/**
			 *
			 * @param err
			 */
			error: err => console.error('VideoEncoder:', err),
		})
		vEnc.configure({
			codec: PRESET.codec,
			width: PRESET.w,
			height: PRESET.h,
			bitrate: PRESET.bps,
			framerate: PRESET.fps,
			latencyMode: 'realtime',
		})
		let lastKey = 0
		const reader = new MediaStreamTrackProcessor({ track: vTrack }).readable.getReader()
		let running = true
		void (async () => {
			while (running) {
				const { value: frame, done } = await reader.read()
				if (done || !frame) break
				const key = performance.now() - lastKey > KEY_MS
				if (key) lastKey = performance.now()
				vEnc.encode(frame, { keyFrame: key })
				frame.close()
			}
			reader.releaseLock()
		})()
		/**
		 *
		 */
		stopVideo = () => { running = false }
	}

	/** @type {AudioEncoder | null} */
	let aEnc = null
	/** @type {() => void} */
	let stopAudio = () => { }

	if (aTrack && 'MediaStreamTrackProcessor' in globalThis) {
		aEnc = new AudioEncoder({
			/**
			 *
			 * @param chunk
			 */
			output: chunk => {
				if (!isAudioSending()) return
				const raw = new Uint8Array(chunk.byteLength)
				chunk.copyTo(raw)
				ws.send(packAvFrame(FRAME_AUDIO, chunk.type === 'key', raw, selfId, t0, audioSeq))
			},
			/**
			 *
			 * @param err
			 */
			error: err => console.error('AudioEncoder:', err),
		})
		aEnc.configure({
			codec: AUDIO_CODEC,
			sampleRate: AUDIO_SAMPLE_RATE,
			numberOfChannels: AUDIO_CHANNELS,
			bitrate: AUDIO_BPS,
		})
		const reader = new MediaStreamTrackProcessor({ track: aTrack }).readable.getReader()
		let running = true
		void (async () => {
			while (running) {
				const { value: data, done } = await reader.read()
				if (done || !data) break
				if (isAudioSending() && audioGate.update(data)) aEnc.encode(data)
				data.close()
			}
			reader.releaseLock()
		})()
		/**
		 *
		 */
		stopAudio = () => { running = false }
	}

	return () => {
		stopVideo()
		stopAudio()
		safeClose(vEnc)
		safeClose(aEnc)
	}
}
