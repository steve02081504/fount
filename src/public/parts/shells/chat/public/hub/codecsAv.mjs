/**
 * 【文件】public/hub/codecsAv.mjs
 * 【职责】Codecs 音视频中继：构建 relay 房间 ID/WebSocket URL，加入/离开 AV 房间与编解码预设。
 * 【原理】与 `streamingAv` 配合更新通话工具栏；本文件侧重 MediaStream/Encoder 与 relay 信令 UI 片段。使用独立 AV relay WebSocket（`buildAvRelayWebSocketUrl`），与群组消息 WS 分离。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/template、../src/wsUrl、core/domUtils
 */
/* global VideoEncoder VideoDecoder EncodedVideoChunk VideoFrame MediaStreamTrackProcessor AudioEncoder AudioDecoder EncodedAudioChunk AudioData */

import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { buildAvRelayWebSocketUrl } from '../src/wsUrl.mjs'

/**
 * Hub 流媒体频道：WebCodecs + av-relay 二进制帧中继。
 *
 * 帧头 26 字节，与 {@link ../../../src/chat/stream/avRelay.mjs} 一致：
 *   [0] frame_type 0=video 1=audio
 */

/**
 * WebCodecs AV 采集/编码预设（分辨率、码率、帧率）。
 * @type {Record<string, { codec: string, w: number, h: number, bps: number, fps: number }>}
 */
export const CODECS_PRESETS = {
	thumb: { codec: 'vp8', w: 160, h: 120, bps: 64_000, fps: 5 },
	low: { codec: 'vp8', w: 320, h: 240, bps: 200_000, fps: 10 },
	med: { codec: 'vp8', w: 640, h: 480, bps: 600_000, fps: 15 },
	high: { codec: 'vp8', w: 1280, h: 720, bps: 1_500_000, fps: 30 },
}

const FRAME_VIDEO = 0
const FRAME_AUDIO = 1
const FRAME_HEADER_BYTES = 26
const KEY_MS = 2000
const AUDIO_CODEC = 'opus'
const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNELS = 1
const AUDIO_BPS = 32_000

/** @type {CodecsAvSession | null} */
let activeSession = null

/**
 * @typedef {object} CodecsAvSession
 * @property {() => Promise<void>} close 离开房间并释放资源
 * @property {() => boolean} toggleMute 切换静音，返回静音后为 true
 * @property {() => boolean} toggleVideo 开关摄像头，返回关闭后为 true
 */

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} av-relay roomId
 */
export function buildAvRelayRoomId(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} WebSocket URL
 */
export function buildAvRelayWsUrl(groupId, channelId) {
	const roomId = buildAvRelayRoomId(groupId, channelId)
	return buildAvRelayWebSocketUrl(roomId)
}

/**
 * @param {Uint8Array} bytes 16 字节 sender id
 * @returns {string} 32 位 hex
 */
function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {number} frameType 0=video 1=audio
 * @param {boolean} isKey 是否关键帧
 * @param {Uint8Array} data 编码数据
 * @param {Uint8Array} selfId 本端 senderId
 * @param {number} t0 session 起点
 * @param {{ seq: number }} seqRef 序列号
 * @returns {ArrayBuffer} 打包帧
 */
function packFrame(frameType, isKey, data, selfId, t0, seqRef) {
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
 * @param {ArrayBuffer} arrayBuffer 入站帧
 * @returns {{ frameType: number, isKey: boolean, sender: string, data: ArrayBuffer } | null} 解析结果
 */
function unpackFrame(arrayBuffer) {
	if (arrayBuffer.byteLength < FRAME_HEADER_BYTES) return null
	const view = new DataView(arrayBuffer)
	return {
		frameType: view.getUint8(0),
		isKey: !!(view.getUint8(1) & 1),
		sender: bytesToHex(new Uint8Array(arrayBuffer, 10, 16)),
		data: arrayBuffer.slice(FRAME_HEADER_BYTES),
	}
}

/**
 * @param {AudioContext} audioContext 播放上下文
 * @param {AudioData} audioData 解码音频
 * @param {{ audioNextTime: number }} peer 远端 peer（写入下一帧调度时间）
 * @returns {void}
 */
function scheduleAudioPlayback(audioContext, audioData, peer) {
	const buffer = audioContext.createBuffer(
		audioData.numberOfChannels,
		audioData.numberOfFrames,
		audioData.sampleRate,
	)
	for (let channelIndex = 0; channelIndex < audioData.numberOfChannels; channelIndex++) {
		const plane = new Float32Array(audioData.numberOfFrames)
		audioData.copyTo(plane, { planeIndex: channelIndex })
		buffer.copyToChannel(plane, channelIndex)
	}
	const source = audioContext.createBufferSource()
	source.buffer = buffer
	source.connect(audioContext.destination)
	const now = audioContext.currentTime
	const start = Math.max(now, peer.audioNextTime || now)
	source.start(start)
	peer.audioNextTime = start + buffer.duration
}

/**
 * @param {object} opts 入参
 * @param {string} opts.groupId 群 ID
 * @param {string} opts.channelId 频道 ID
 * @param {keyof typeof CODECS_PRESETS} [opts.presetKey] 画质预设
 * @param {HTMLElement} opts.avGrid 远端 tile 容器
 * @param {HTMLVideoElement | null} [opts.videoLocal] 本地预览
 * @param {(count: number) => void} [opts.onPeerCount] 在线人数
 * @returns {Promise<CodecsAvSession>} 会话句柄
 */
export async function joinCodecsAvRoom(opts) {
	if (!('VideoEncoder' in window) || !('AudioEncoder' in window))
		throw new Error('WebCodecs not supported')

	const {
		groupId,
		channelId,
		presetKey = 'med',
		avGrid,
		videoLocal = null,
		onPeerCount,
	} = opts

	await leaveCodecsAvRoom()

	const preset = CODECS_PRESETS[presetKey] || CODECS_PRESETS.med
	const selfId = crypto.getRandomValues(new Uint8Array(16))
	const selfHex = bytesToHex(selfId)
	const t0 = performance.now()
	const videoSeqRef = { seq: 0 }
	const audioSeqRef = { seq: 0 }

	/** @type {Map<string, object>} */
	const peers = new Map()
	/** @type {Map<string, Promise<object>>} */
	const peersCreating = new Map()

	const ws = new WebSocket(buildAvRelayWsUrl(groupId, channelId))
	ws.binaryType = 'arraybuffer'

	/**
	 * @param {string} senderIdHex 远端 senderId（32 位 hex）
	 * @returns {Promise<object>} peer 状态
	 */
	const getOrCreatePeer = async senderIdHex => {
		if (peers.has(senderIdHex)) return peers.get(senderIdHex)
		if (peersCreating.has(senderIdHex)) return peersCreating.get(senderIdHex)

		const promise = (async () => {
			const canvas = document.createElement('canvas')
			canvas.width = preset.w
			canvas.height = preset.h
			const canvas2d = canvas.getContext('2d')

			const tile = await renderTemplate('hub/streaming/av_tile', {
				peerId: senderIdHex,
				label: `…${senderIdHex.slice(-8)}`,
			})
			tile.querySelector('.hub-streaming-av-canvas-host')?.appendChild(canvas)
			avGrid.appendChild(tile)

			const audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
			/** @type {{ tile: HTMLElement, videoDecoder: VideoDecoder, videoHasKey: boolean, videoRxSeq: number, audioDecoder: AudioDecoder, audioCtx: AudioContext, audioHasKey: boolean, audioRxSeq: number, audioNextTime: number }} */
			const peer = {
				tile,
				videoDecoder: null,
				videoHasKey: false,
				videoRxSeq: 0,
				audioDecoder: null,
				audioCtx,
				audioHasKey: false,
				audioRxSeq: 0,
				audioNextTime: 0,
			}

			peer.videoDecoder = new VideoDecoder({
				/**
				 * @param {VideoFrame} frame 解码帧
				 * @returns {void}
				 */
				output: frame => {
					canvas2d.drawImage(frame, 0, 0, preset.w, preset.h)
					frame.close()
				},
				/**
				 * @param {Error} error 解码错误
				 * @returns {void}
				 */
				error: error => console.error('VideoDecoder:', error),
			})
			peer.videoDecoder.configure({ codec: preset.codec, codedWidth: preset.w, codedHeight: preset.h })

			peer.audioDecoder = new AudioDecoder({
				/**
				 * @param {AudioData} audioData 解码音频
				 * @returns {void}
				 */
				output: audioData => {
					scheduleAudioPlayback(audioCtx, audioData, peer)
					audioData.close()
				},
				/**
				 * @param {Error} error 解码错误
				 * @returns {void}
				 */
				error: error => console.error('AudioDecoder:', error),
			})
			peer.audioDecoder.configure({
				codec: AUDIO_CODEC,
				sampleRate: AUDIO_SAMPLE_RATE,
				numberOfChannels: AUDIO_CHANNELS,
			})

			peers.set(senderIdHex, peer)
			peersCreating.delete(senderIdHex)
			return peer
		})()

		peersCreating.set(senderIdHex, promise)
		return promise
	}

	/**
	 * @param {ArrayBuffer} arrayBuffer 入站帧
	 * @returns {Promise<void>}
	 */
	const handleInboundFrame = async arrayBuffer => {
		const frame = unpackFrame(arrayBuffer)
		if (!frame || frame.sender === selfHex) return
		const peer = await getOrCreatePeer(frame.sender)

		if (frame.frameType === FRAME_AUDIO) {
			if (!frame.isKey && !peer.audioHasKey) return
			if (frame.isKey) peer.audioHasKey = true
			if (peer.audioDecoder.decodeQueueSize > 8) return
			peer.audioRxSeq++
			peer.audioDecoder.decode(new EncodedAudioChunk({
				type: frame.isKey ? 'key' : 'delta',
				timestamp: peer.audioRxSeq * 20_000,
				data: frame.data,
			}))
			return
		}

		if (!frame.isKey && !peer.videoHasKey) return
		if (frame.isKey) peer.videoHasKey = true
		if (peer.videoDecoder.decodeQueueSize > 10) return
		peer.videoRxSeq++
		peer.videoDecoder.decode(new EncodedVideoChunk({
			type: frame.isKey ? 'key' : 'delta',
			timestamp: peer.videoRxSeq * Math.round(1_000_000 / preset.fps),
			data: frame.data,
		}))
	}

	/**
	 * @param {MessageEvent} event WS 消息
	 * @returns {void}
	 */
	ws.onmessage = event => {
		if (event.data instanceof ArrayBuffer) {
			void handleInboundFrame(event.data)
			return
		}
		const wireMessage = JSON.parse(event.data)
		if (wireMessage.type === 'peer_count')
			onPeerCount?.(wireMessage.count)
	}

	await new Promise((res, rej) => {
		ws.onopen = res
		ws.onerror = rej
	})

	/**
	 * 停止本地采集与编码循环（由 startCodecsCapture 赋值）。
	 * @type {() => void}
	 */
	let stopCapture = () => { }
	let mediaStream = null
	let videoEnabled = true
	let audioMuted = false

	try {
		stopCapture = await startCodecsCapture({
			preset,
			ws,
			selfId,
			t0,
			videoSeqRef,
			audioSeqRef,
			videoLocal,
			/**
			 * @returns {boolean} 是否发送视频
			 */
			isVideoSending: () => videoEnabled && ws.readyState === WebSocket.OPEN,
			/**
			 * @returns {boolean} 是否发送音频
			 */
			isAudioSending: () => !audioMuted && ws.readyState === WebSocket.OPEN,
			/**
			 * @param {MediaStream} stream 采集流
			 * @returns {void}
			 */
			onStream: stream => { mediaStream = stream },
		})
	}
	catch (error) {
		ws.close()
		throw error
	}

	/** @type {CodecsAvSession} */
	const session = {
		/**
		 * @returns {Promise<void>}
		 */
		close: async () => {
			if (activeSession !== session) return
			activeSession = null
			stopCapture()
			mediaStream?.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
			ws.close()
			for (const peer of peers.values()) {
				try { peer.videoDecoder.close() } catch { /* ignore */ }
				try { peer.audioDecoder.close() } catch { /* ignore */ }
				try { await peer.audioCtx.close() } catch { /* ignore */ }
				peer.tile.remove()
			}
			peers.clear()
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

	activeSession = session
	return session
}

/**
 * 离开当前 WebCodecs 会话。
 * @returns {Promise<void>}
 */
export async function leaveCodecsAvRoom() {
	if (!activeSession) return
	const session = activeSession
	activeSession = null
	await session.close()
}

/**
 * @param {object} opts 采集参数
 * @returns {Promise<() => void>} 停止函数
 */
async function startCodecsCapture(opts) {
	const {
		preset, ws, selfId, t0, videoSeqRef, audioSeqRef,
		videoLocal, isVideoSending, isAudioSending, onStream,
	} = opts

	const stream = await navigator.mediaDevices.getUserMedia({
		video: { width: preset.w, height: preset.h, frameRate: preset.fps },
		audio: {
			echoCancellation: true,
			noiseSuppression: true,
			sampleRate: AUDIO_SAMPLE_RATE,
			channelCount: AUDIO_CHANNELS,
		},
	})
	onStream(stream)
	if (videoLocal) {
		videoLocal.srcObject = stream
		videoLocal.muted = true
	}

	const stopVideo = await startVideoEncoder({
		preset, stream, ws, selfId, t0, videoSeqRef, isVideoSending,
	})
	const stopAudio = await startAudioEncoder({
		stream, ws, selfId, t0, audioSeqRef, isAudioSending,
	})

	return () => {
		stopVideo()
		stopAudio()
		stream.getTracks().forEach(t => t.stop())
	}
}

/**
 * @param {object} opts 视频编码参数
 * @returns {Promise<() => void>} 停止视频编码函数
 */
async function startVideoEncoder(opts) {
	const { preset, stream, ws, selfId, t0, videoSeqRef, isVideoSending } = opts
	const [track] = stream.getVideoTracks()
	if (!track) return () => { }

	const encoder = new VideoEncoder({
		/**
		 * @param {EncodedVideoChunk} chunk 编码块
		 * @returns {void}
		 */
		output: chunk => {
			if (!isVideoSending()) return
			const raw = new Uint8Array(chunk.byteLength)
			chunk.copyTo(raw)
			ws.send(packFrame(FRAME_VIDEO, chunk.type === 'key', raw, selfId, t0, videoSeqRef))
		},
		/**
		 * @param {Error} error 编码错误
		 * @returns {void}
		 */
		error: error => console.error('VideoEncoder:', error),
	})
	encoder.configure({
		codec: preset.codec,
		width: preset.w,
		height: preset.h,
		bitrate: preset.bps,
		framerate: preset.fps,
		latencyMode: 'realtime',
	})

	let lastKeyTs = 0

	/**
	 * @param {VideoFrame} frame 待编码帧
	 * @returns {void}
	 */
	const encodeFrame = frame => {
		const isKey = performance.now() - lastKeyTs > KEY_MS
		if (isKey) lastKeyTs = performance.now()
		encoder.encode(frame, { keyFrame: isKey })
		frame.close()
	}

	/** @returns {void} */
	let stopReader = () => { }

	if ('MediaStreamTrackProcessor' in window) {
		const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
		let running = true
		void (async () => {
			while (running) {
				const { value: frame, done } = await reader.read()
				if (done || !frame) break
				encodeFrame(frame)
			}
			reader.releaseLock()
		})()
		/** @returns {void} */
		stopReader = () => { running = false }
	}
	else {
		const fallbackVideo = Object.assign(document.createElement('video'), { autoplay: true, muted: true })
		fallbackVideo.srcObject = stream
		await new Promise(resolve => { fallbackVideo.onloadedmetadata = resolve })
		const offscreenCanvas = new OffscreenCanvas(preset.w, preset.h)
		const canvasContext = offscreenCanvas.getContext('2d')
		const frameInterval = setInterval(() => {
			canvasContext.drawImage(fallbackVideo, 0, 0, preset.w, preset.h)
			encodeFrame(new VideoFrame(offscreenCanvas, { timestamp: (performance.now() - t0) * 1000 }))
		}, 1000 / preset.fps)
		/** @returns {void} */
		stopReader = () => clearInterval(frameInterval)
	}

	return () => {
		stopReader()
		try { encoder.close() } catch { /* ignore */ }
	}
}

/**
 * @param {object} opts 音频编码参数
 * @returns {Promise<() => void>} 停止音频编码函数
 */
async function startAudioEncoder(opts) {
	const { stream, ws, selfId, t0, audioSeqRef, isAudioSending } = opts
	const track = stream.getAudioTracks()[0]
	if (!track) return () => { }

	const encoder = new AudioEncoder({
		/**
		 * @param {EncodedAudioChunk} chunk 编码块
		 * @returns {void}
		 */
		output: chunk => {
			if (!isAudioSending()) return
			const raw = new Uint8Array(chunk.byteLength)
			chunk.copyTo(raw)
			ws.send(packFrame(FRAME_AUDIO, chunk.type === 'key', raw, selfId, t0, audioSeqRef))
		},
		/**
		 * @param {Error} error 编码错误
		 * @returns {void}
		 */
		error: error => console.error('AudioEncoder:', error),
	})
	encoder.configure({
		codec: AUDIO_CODEC,
		sampleRate: AUDIO_SAMPLE_RATE,
		numberOfChannels: AUDIO_CHANNELS,
		bitrate: AUDIO_BPS,
	})

	/** @returns {void} */
	let stopReader = () => { }

	if ('MediaStreamTrackProcessor' in window) {
		const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
		let running = true
		void (async () => {
			while (running) {
				const { value: audioData, done } = await reader.read()
				if (done || !audioData) break
				if (isAudioSending()) encoder.encode(audioData)
				audioData.close()
			}
			reader.releaseLock()
		})()
		/**
		 * 停止音频 reader 循环。
		 * @returns {void}
		 */
		stopReader = () => { running = false }
	}

	return () => {
		stopReader()
		try { encoder.close() } catch { /* ignore */ }
	}
}
