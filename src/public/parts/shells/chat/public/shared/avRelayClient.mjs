/**
 * 【文件】public/shared/avRelayClient.mjs
 * 【职责】WebCodecs + AV relay 精简客户端（推流 / 解码播画）；导出帧协议工具。Social live 复用 joinAvRelayRoom。
 * 【原理】26 字节帧头与 chat `avRelay.mjs` 一致；支持 av/audio/video 模式、publish_meta 协商、VAD 门限。
 */
/* global VideoEncoder VideoDecoder EncodedVideoChunk VideoFrame MediaStreamTrackProcessor AudioEncoder AudioDecoder EncodedAudioChunk AudioData */

import { buildWebSocketUrl } from '../src/wsUrl.mjs'

import { createAudioGate } from './audioGate.mjs'
import { CODECS_PRESETS } from './avRelayPresets.mjs'
import { bytesToHex } from './digest.mjs'

/** 重导出 {@link ./digest.mjs} 的 `bytesToHex`。 */
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
/** 音频编码器 codec 标识（Opus）。 */
export const AUDIO_CODEC = 'opus'
/** 音频采样率（Hz）。 */
export const AUDIO_SAMPLE_RATE = 48_000
/** 音频声道数。 */
export const AUDIO_CHANNELS = 1
/** 音频目标码率（bps）。 */
export const AUDIO_BPS = 32_000

/**
 * av-relay 会话句柄。
 * @typedef {object} AvRelaySession
 * @property {() => void} close 关闭会话并释放资源
 * @property {() => boolean} toggleMute 切换静音，返回静音后为 true
 * @property {() => boolean} toggleVideo 开关摄像头，返回关闭后为 true
 * @property {(mode: 'full' | 'preview') => void} [setMode] 切换订阅模式
 * @property {() => 'full' | 'preview'} [getMode] 当前订阅模式
 * @property {(senderId?: string) => number[]} [getAudioLevels] 读取音频电平（16 频段）
 * @property {() => object | null} [getLocalPublishMeta] 本端 publish_meta 快照
 */

/**
 * 安全关闭带 `close()` 的资源（忽略异常）。
 * @param {{ close?: () => unknown } | null | undefined} resource 可关闭对象
 * @returns {void}
 */
export function safeClose(resource) {
	try {
		const closing = resource?.close?.()
		void closing?.catch?.(() => { })
	}
	catch { /* ignore */ }
}

/**
 * 构建 chat av-relay WebSocket URL。
 * @param {string} roomId 房间 ID
 * @returns {string} ws URL
 */
export function buildChatAvRelayWsUrl(roomId) {
	return buildWebSocketUrl(`/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}`)
}

/**
 * 构建群通话 WebSocket URL。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} ws URL
 */
export function buildChatCallWsUrl(groupId, channelId) {
	return buildWebSocketUrl(
		`/ws/parts/shells:chat/call/${encodeURIComponent(groupId)}/${encodeURIComponent(channelId)}`,
	)
}

/**
 * 打包 av-relay 二进制帧（26 字节头 + 载荷）。
 * @param {number} frameType 帧类型（0 视频 / 1 音频 / 2 屏幕）
 * @param {boolean} isKey 是否关键帧
 * @param {ArrayBufferView} data 编码载荷
 * @param {Uint8Array} selfId 16 字节发送者 ID
 * @param {number} t0 会话起点 `performance.now()`
 * @param {{ seq: number }} seqRef 递增序号容器
 * @returns {ArrayBuffer} 完整帧
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
 * 解包 av-relay 二进制帧。
 * @param {ArrayBuffer} buf 原始帧
 * @returns {{ frameType: number, isKey: boolean, sender: string, data: ArrayBuffer } | null} 解析结果；过短为 null
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
 * 从 publish_meta 推导 WebCodecs 视频 codec 字符串。
 * @param {object | null | undefined} videoMeta `publish_meta.video`
 * @returns {string} WebCodecs codec 字符串
 */
function videoCodecString(videoMeta) {
	if (!videoMeta) return PRESET.codec
	const c = String(videoMeta.codec || '').toLowerCase()
	if (c === 'avc' || c === 'h264') return 'avc1.42E01E'
	return PRESET.codec
}

/**
 * 加入 av-relay 房间：推流或订阅解码。
 * @param {object} options 会话选项
 * @param {string} options.wsUrl WebSocket URL
 * @param {(buf: ArrayBuffer) => void} [options.onBinaryFrame] 收到原始帧
 * @param {(count: number) => void} [options.onPeerCount] 对端数量变化
 * @param {(meta: object) => void} [options.onPublishMeta] 远端 publish_meta
 * @param {boolean} [options.asPublisher] 是否推流
 * @param {HTMLCanvasElement | null} [options.canvas] 远端视频画布
 * @param {HTMLVideoElement | null} [options.videoLocal] 本地预览
 * @param {HTMLElement | null} [options.voiceRingHost] 声波环宿主
 * @param {'full' | 'preview'} [options.mode] 订阅模式
 * @param {'av' | 'audio' | 'video'} [options.media] 媒体子集
 * @returns {Promise<AvRelaySession>} 会话句柄
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
	 * 向 relay 广播本端 publish_meta。
	 * @returns {void}
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
	 * 按远端 meta 懒创建 VideoDecoder 并绑定画布。
	 * @param {string} sender 发送者 hex ID
	 * @param {object | null | undefined} meta publish_meta
	 * @returns {void}
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
			 * @param {VideoFrame} frame 解码帧
			 * @returns {void}
			 */
			output: frame => {
				ctx2d.drawImage(frame, 0, 0, w, h)
				frame.close()
			},
			/**
			 * @param {DOMException} err 解码错误
			 * @returns {void}
			 */
			error: err => console.error('VideoDecoder:', err),
		})
		videoDecoder.configure({ codec, codedWidth: w, codedHeight: h })
		videoMeta = meta
		remoteSender = sender
	}

	/**
	 * 懒创建 AudioDecoder 与播放链路。
	 * @returns {void}
	 */
	const ensureAudioDecoder = () => {
		if (audioDecoder || mode === 'preview') return
		audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
		audioDecoder = new AudioDecoder({
			/**
			 * @param {AudioData} audioData 解码 PCM
			 * @returns {void}
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
			 * @param {DOMException} err 解码错误
			 * @returns {void}
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
	 * 处理入站二进制帧：解码或转发给回调。
	 * @param {ArrayBuffer} arrayBuffer 原始帧
	 * @returns {void}
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
	 * WebSocket 消息：二进制帧或 JSON 控制。
	 * @param {MessageEvent} event 消息事件
	 * @returns {void}
	 */
	ws.onmessage = event => {
		if (event.data instanceof ArrayBuffer) {
			handleInbound(event.data)
			return
		}
		const controlFrame = JSON.parse(event.data)
		if (controlFrame.type === 'peer_count') onPeerCount?.(controlFrame.count)
		if (controlFrame.type === 'publish_meta') {
			const sid = controlFrame.senderId || ''
			remoteMeta.set(sid, controlFrame)
			onPublishMeta?.(controlFrame)
			if (!asPublisher && !videoDecoder && canvas && controlFrame.video)
				ensureVideoDecoder(sid, controlFrame)
			if (!asPublisher && !audioDecoder && controlFrame.audio && mode === 'full')
				ensureAudioDecoder()
		}
		if (controlFrame.type === 'publish_meta_revoke') {
			const sid = controlFrame.senderId || ''
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
	 * 停止采集与编码循环。
	 * @returns {void}
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
				 * 视频轨道是否应编码发送。
				 * @returns {boolean} 是否发送
				 */
				isVideoSending: () => videoEnabled && ws.readyState === WebSocket.OPEN,
				/**
				 * 音频轨道是否应编码发送（含静音与 VAD）。
				 * @returns {boolean} 是否发送
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
		 * 关闭会话、释放编解码器与媒体轨道。
		 * @returns {void}
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
		 * 切换麦克风静音。
		 * @returns {boolean} 切换后是否静音
		 */
		toggleMute: () => {
			audioMuted = !audioMuted
			const track = mediaStream?.getAudioTracks()[0]
			if (track) track.enabled = !audioMuted
			return audioMuted
		},
		/**
		 * 切换摄像头开关。
		 * @returns {boolean} 切换后是否关闭视频
		 */
		toggleVideo: () => {
			if (!wantsVideo) return true
			videoEnabled = !videoEnabled
			const track = mediaStream?.getVideoTracks()[0]
			if (track) track.enabled = videoEnabled
			return !videoEnabled
		},
		/**
		 * 切换订阅模式（full 含音频 / preview 仅关键帧视频）。
		 * @param {'full' | 'preview'} next 目标模式
		 * @returns {void}
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
		 * 当前订阅模式。
		 * @returns {'full' | 'preview'} 当前模式
		 */
		getMode: () => mode,
		/**
		 * 环形频带电平（0..1），用于声波 UI。
		 * @param {string} [senderId] 发送者 hex；省略用最近远端或本端
		 * @returns {number[]} 16 段电平
		 */
		getAudioLevels: (senderId = '') => {
			const sid = senderId || remoteSender || 'default'
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
		 * 本端 publish_meta 快照。
		 * @returns {object} publish_meta 形对象
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
 * 从 MediaStream 编码并推送 av-relay 帧。
 * @param {object} options 推流参数
 * @param {MediaStream} options.mediaStream 采集流
 * @param {WebSocket} options.ws 已连接的 relay socket
 * @param {Uint8Array} options.selfId 发送者 ID
 * @param {number} options.t0 会话起点
 * @param {{ seq: number }} options.videoSeq 视频序号
 * @param {{ seq: number }} options.audioSeq 音频序号
 * @param {boolean} options.wantsVideo 是否推视频
 * @param {boolean} options.wantsAudio 是否推音频
 * @param {ReturnType<typeof createAudioGate>} options.audioGate VAD 门控
 * @param {() => boolean} options.isVideoSending 是否发送视频
 * @param {() => boolean} options.isAudioSending 是否发送音频
 * @returns {Promise<() => void>} 停止推流的清理函数
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
			 * @param {EncodedVideoChunk} chunk 编码块
			 * @returns {void}
			 */
			output: chunk => {
				if (!isVideoSending()) return
				const raw = new Uint8Array(chunk.byteLength)
				chunk.copyTo(raw)
				ws.send(packAvFrame(FRAME_VIDEO, chunk.type === 'key', raw, selfId, t0, videoSeq))
			},
			/**
			 * @param {DOMException} err 编码错误
			 * @returns {void}
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
		 * 停止视频采集循环。
		 * @returns {void}
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
			 * @param {EncodedAudioChunk} chunk 编码块
			 * @returns {void}
			 */
			output: chunk => {
				if (!isAudioSending()) return
				const raw = new Uint8Array(chunk.byteLength)
				chunk.copyTo(raw)
				ws.send(packAvFrame(FRAME_AUDIO, chunk.type === 'key', raw, selfId, t0, audioSeq))
			},
			/**
			 * @param {DOMException} err 编码错误
			 * @returns {void}
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
		 * 停止音频采集循环。
		 * @returns {void}
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
