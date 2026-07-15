/**
 * 【文件】public/shared/avRelayClient.mjs
 * 【职责】Chat / Social 共用的 WebCodecs + AV relay 精简客户端（推流 / 解码播画）。
 * 【原理】26 字节帧头与 chat `avRelay.mjs` 一致；URL 基于当前页协议；preset 固定 med。
 * 【关联】chat hub codecsAv；social live-av WS
 */
/* global VideoEncoder VideoDecoder EncodedVideoChunk VideoFrame MediaStreamTrackProcessor AudioEncoder AudioDecoder EncodedAudioChunk AudioData */

import { buildWebSocketUrl } from '../src/wsUrl.mjs'

const PRESET = { codec: 'vp8', w: 640, h: 480, bps: 600_000, fps: 15 }
const FRAME_VIDEO = 0
const FRAME_AUDIO = 1
const FRAME_HEADER = 26
const KEY_MS = 2000
const AUDIO_CODEC = 'opus'
const AUDIO_RATE = 48_000
const AUDIO_CH = 1
const AUDIO_BPS = 32_000

/**
 * @typedef {object} AvRelaySession
 * @property {() => void} close 断开 WS 并释放编解码 / 采集
 * @property {() => boolean} toggleMute 切换静音，返回静音后为 true
 * @property {() => boolean} toggleVideo 开关摄像头，返回关闭后为 true
 */

/**
 * @param {string} entityHash 主播 entity hash
 * @param {string} liveId 直播场次 ID
 * @returns {string} Social live-av WebSocket URL
 */
export function buildSocialLiveAvWsUrl(entityHash, liveId) {
	return buildWebSocketUrl(
		`/ws/parts/shells:social/live-av/${encodeURIComponent(entityHash)}/${encodeURIComponent(liveId)}`,
	)
}

/**
 * @param {string} roomId Chat av-relay 房间 ID（如 `groupId:channelId`）
 * @returns {string} Chat av-relay WebSocket URL
 */
export function buildChatAvRelayWsUrl(roomId) {
	return buildWebSocketUrl(`/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}`)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 群组通话 WebSocket URL
 */
export function buildChatCallWsUrl(groupId, channelId) {
	return buildWebSocketUrl(
		`/ws/parts/shells:chat/call/${encodeURIComponent(groupId)}/${encodeURIComponent(channelId)}`,
	)
}

/**
 * @param {Uint8Array} bytes 原始字节
 * @returns {string} 小写 hex
 */
function bytesToHex(bytes) {
	return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {number} frameType 0=video 1=audio
 * @param {boolean} isKey 是否关键帧
 * @param {Uint8Array} data 编码载荷
 * @param {Uint8Array} selfId 本端 senderId（16 字节）
 * @param {number} t0 session 起点（performance.now）
 * @param {{ seq: number }} seqRef 序列号引用
 * @returns {ArrayBuffer} 打包后的 relay 帧
 */
function packFrame(frameType, isKey, data, selfId, t0, seqRef) {
	const out = new Uint8Array(FRAME_HEADER + data.byteLength)
	const dv = new DataView(out.buffer)
	dv.setUint8(0, frameType)
	dv.setUint8(1, isKey ? 1 : 0)
	dv.setUint32(2, seqRef.seq++, false)
	dv.setUint32(6, (performance.now() - t0) | 0, false)
	out.set(selfId, 10)
	out.set(data, FRAME_HEADER)
	return out.buffer
}

/**
 * @param {ArrayBuffer} buf 入站帧
 * @returns {{ frameType: number, isKey: boolean, sender: string, data: ArrayBuffer } | null} 解析结果
 */
function unpackFrame(buf) {
	if (buf.byteLength < FRAME_HEADER) return null
	const view = new DataView(buf)
	return {
		frameType: view.getUint8(0),
		isKey: !!(view.getUint8(1) & 1),
		sender: bytesToHex(new Uint8Array(buf, 10, 16)),
		data: buf.slice(FRAME_HEADER),
	}
}

/**
 * 加入 AV relay 房间：推流或解码播画（单远端、med 预设）。
 * @param {object} opts 入参
 * @param {string} opts.wsUrl relay WebSocket URL
 * @param {(buf: ArrayBuffer) => void} [opts.onBinaryFrame] 原始入站二进制（解码前）
 * @param {(count: number) => void} [opts.onPeerCount] peer_count 信令
 * @param {boolean} [opts.asPublisher=false] true=采集编码推流；false=解码播画
 * @param {HTMLCanvasElement} [opts.canvas] 远端视频绘制目标（观众侧）
 * @param {HTMLVideoElement} [opts.videoLocal] 本地预览（推流侧）
 * @returns {Promise<AvRelaySession>} 会话句柄
 */
export async function joinAvRelayRoom(opts) {
	const {
		wsUrl,
		onBinaryFrame,
		onPeerCount,
		asPublisher = false,
		canvas = null,
		videoLocal = null,
	} = opts

	if (asPublisher && (!('VideoEncoder' in globalThis) || !('AudioEncoder' in globalThis)))
		throw new Error('WebCodecs not supported')
	if (!asPublisher && (!('VideoDecoder' in globalThis) || !('AudioDecoder' in globalThis)))
		throw new Error('WebCodecs not supported')

	const selfId = crypto.getRandomValues(new Uint8Array(16))
	const selfHex = bytesToHex(selfId)
	const t0 = performance.now()
	const videoSeq = { seq: 0 }
	const audioSeq = { seq: 0 }

	const ws = new WebSocket(wsUrl)
	ws.binaryType = 'arraybuffer'

	/** @type {VideoDecoder | null} */
	let videoDecoder = null
	/** @type {AudioDecoder | null} */
	let audioDecoder = null
	/** @type {AudioContext | null} */
	let audioCtx = null
	let videoHasKey = false
	let audioHasKey = false
	let videoRx = 0
	let audioRx = 0
	let audioNextTime = 0

	if (!asPublisher && canvas) {
		const ctx2d = canvas.getContext('2d')
		canvas.width = PRESET.w
		canvas.height = PRESET.h
		audioCtx = new AudioContext({ sampleRate: AUDIO_RATE })

		videoDecoder = new VideoDecoder({
			/**
			 * @param {VideoFrame} frame 解码帧
			 * @returns {void}
			 */
			output: frame => {
				ctx2d.drawImage(frame, 0, 0, PRESET.w, PRESET.h)
				frame.close()
			},
			/**
			 * @param {Error} err 解码错误
			 * @returns {void}
			 */
			error: err => console.error('VideoDecoder:', err),
		})
		videoDecoder.configure({ codec: PRESET.codec, codedWidth: PRESET.w, codedHeight: PRESET.h })

		audioDecoder = new AudioDecoder({
			/**
			 * @param {AudioData} audioData 解码音频
			 * @returns {void}
			 */
			output: audioData => {
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
				const src = audioCtx.createBufferSource()
				src.buffer = buf
				src.connect(audioCtx.destination)
				const now = audioCtx.currentTime
				const start = Math.max(now, audioNextTime || now)
				src.start(start)
				audioNextTime = start + buf.duration
				audioData.close()
			},
			/**
			 * @param {Error} err 解码错误
			 * @returns {void}
			 */
			error: err => console.error('AudioDecoder:', err),
		})
		audioDecoder.configure({
			codec: AUDIO_CODEC,
			sampleRate: AUDIO_RATE,
			numberOfChannels: AUDIO_CH,
		})
	}

	/**
	 * @param {ArrayBuffer} arrayBuffer 入站帧
	 * @returns {void}
	 */
	const handleInbound = arrayBuffer => {
		onBinaryFrame?.(arrayBuffer)
		if (asPublisher || !videoDecoder) return
		const frame = unpackFrame(arrayBuffer)
		if (!frame || frame.sender === selfHex) return

		if (frame.frameType === FRAME_AUDIO) {
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

		if (!frame.isKey && !videoHasKey) return
		if (frame.isKey) videoHasKey = true
		if (videoDecoder.decodeQueueSize > 10) return
		videoRx++
		videoDecoder.decode(new EncodedVideoChunk({
			type: frame.isKey ? 'key' : 'delta',
			timestamp: videoRx * Math.round(1_000_000 / PRESET.fps),
			data: frame.data,
		}))
	}

	/**
	 * @param {MessageEvent} event WS 消息
	 * @returns {void}
	 */
	ws.onmessage = event => {
		if (event.data instanceof ArrayBuffer) {
			handleInbound(event.data)
			return
		}
		const msg = JSON.parse(event.data)
		if (msg.type === 'peer_count') onPeerCount?.(msg.count)
	}

	await new Promise((res, rej) => {
		ws.onopen = res
		ws.onerror = rej
	})

	/** @type {MediaStream | null} */
	let mediaStream = null
	/** @type {() => void} */
	let stopCapture = () => { }
	let videoEnabled = true
	let audioMuted = false

	if (asPublisher) 
		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({
				video: { width: PRESET.w, height: PRESET.h, frameRate: PRESET.fps },
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					sampleRate: AUDIO_RATE,
					channelCount: AUDIO_CH,
				},
			})
			if (videoLocal) {
				videoLocal.srcObject = mediaStream
				videoLocal.muted = true
			}

			/**
			 * @returns {boolean} WS 是否可发
			 */
			const open = () => ws.readyState === WebSocket.OPEN
			stopCapture = await startPublish(
				mediaStream, ws, selfId, t0, videoSeq, audioSeq,
				() => videoEnabled && open(),
				() => !audioMuted && open(),
			)
		}
		catch (err) {
			ws.close()
			throw err
		}
	

	return {
		/**
		 * @returns {void}
		 */
		close: () => {
			stopCapture()
			mediaStream?.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
			try { videoDecoder?.close() } catch { /* ignore */ }
			try { audioDecoder?.close() } catch { /* ignore */ }
			void audioCtx?.close()
			ws.close()
		},
		/**
		 * @returns {boolean} 静音后为 true
		 */
		toggleMute: () => {
			audioMuted = !audioMuted
			const track = mediaStream?.getAudioTracks()[0]
			if (track) track.enabled = !audioMuted
			return audioMuted
		},
		/**
		 * @returns {boolean} 关闭视频后为 true
		 */
		toggleVideo: () => {
			videoEnabled = !videoEnabled
			const track = mediaStream?.getVideoTracks()[0]
			if (track) track.enabled = videoEnabled
			return !videoEnabled
		},
	}
}

/**
 * @param {MediaStream} stream 采集流
 * @param {WebSocket} ws relay 套接字
 * @param {Uint8Array} selfId 本端 senderId
 * @param {number} t0 session 起点
 * @param {{ seq: number }} videoSeq 视频序号
 * @param {{ seq: number }} audioSeq 音频序号
 * @param {() => boolean} isVideoSending 是否发视频
 * @param {() => boolean} isAudioSending 是否发音频
 * @returns {Promise<() => void>} 停止函数
 */
async function startPublish(stream, ws, selfId, t0, videoSeq, audioSeq, isVideoSending, isAudioSending) {
	const [vTrack] = stream.getVideoTracks()
	const aTrack = stream.getAudioTracks()[0]

	const vEnc = new VideoEncoder({
		/**
		 * @param {EncodedVideoChunk} chunk 编码块
		 * @returns {void}
		 */
		output: chunk => {
			if (!isVideoSending()) return
			const raw = new Uint8Array(chunk.byteLength)
			chunk.copyTo(raw)
			ws.send(packFrame(FRAME_VIDEO, chunk.type === 'key', raw, selfId, t0, videoSeq))
		},
		/**
		 * @param {Error} err 编码错误
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
	/** @type {() => void} */
	let stopVideo = () => { }

	if (vTrack && 'MediaStreamTrackProcessor' in globalThis) {
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

	const aEnc = new AudioEncoder({
		/**
		 * @param {EncodedAudioChunk} chunk 编码块
		 * @returns {void}
		 */
		output: chunk => {
			if (!isAudioSending()) return
			const raw = new Uint8Array(chunk.byteLength)
			chunk.copyTo(raw)
			ws.send(packFrame(FRAME_AUDIO, chunk.type === 'key', raw, selfId, t0, audioSeq))
		},
		/**
		 * @param {Error} err 编码错误
		 * @returns {void}
		 */
		error: err => console.error('AudioEncoder:', err),
	})
	aEnc.configure({
		codec: AUDIO_CODEC,
		sampleRate: AUDIO_RATE,
		numberOfChannels: AUDIO_CH,
		bitrate: AUDIO_BPS,
	})

	/** @type {() => void} */
	let stopAudio = () => { }

	if (aTrack && 'MediaStreamTrackProcessor' in globalThis) {
		const reader = new MediaStreamTrackProcessor({ track: aTrack }).readable.getReader()
		let running = true
		void (async () => {
			while (running) {
				const { value: data, done } = await reader.read()
				if (done || !data) break
				if (isAudioSending()) aEnc.encode(data)
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
		try { vEnc.close() } catch { /* ignore */ }
		try { aEnc.close() } catch { /* ignore */ }
	}
}
