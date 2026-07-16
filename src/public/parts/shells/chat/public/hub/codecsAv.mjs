/**
 * 【文件】public/hub/codecsAv.mjs
 * 【职责】Codecs 音视频中继：构建 relay 房间 ID/WebSocket URL，加入/离开 AV 房间与编解码预设。
 * 【原理】与 `streamingAv` 配合更新通话工具栏；本文件侧重 MediaStream/Encoder 与 relay 信令 UI 片段。使用独立 AV relay WebSocket（`buildAvRelayWebSocketUrl`），与群组消息 WS 分离。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../shared/avRelayClient（帧协议 / URL）、../shared/avRelayPresets、../../../../scripts/template、core/domUtils
 */
/* global VideoEncoder VideoDecoder EncodedVideoChunk VideoFrame MediaStreamTrackProcessor AudioEncoder AudioDecoder EncodedAudioChunk AudioData */

import { renderTemplate } from '../../../../scripts/features/template.mjs'
import {
	AUDIO_BPS,
	AUDIO_CHANNELS,
	AUDIO_CODEC,
	AUDIO_SAMPLE_RATE,
	FRAME_AUDIO,
	FRAME_SCREEN,
	FRAME_VIDEO,
	bytesToHex,
	buildChatAvRelayWsUrl,
	packAvFrame,
	safeClose,
	unpackAvFrame,
} from '../shared/avRelayClient.mjs'
import { createAudioGate } from '../shared/audioGate.mjs'
import { CODECS_PRESETS } from '../shared/avRelayPresets.mjs'

/**
 * Hub 流媒体频道：WebCodecs + av-relay 二进制帧中继。
 *
 * 帧头 26 字节，与 {@link ../../../src/chat/ws/avRelay.mjs} 一致：
 *   [0] frame_type 0=video 1=audio 2=screen
 */

const KEY_MS = 2000

/** @type {CodecsAvSession | null} */
let activeSession = null

/**
 * @typedef {object} CodecsAvSession
 * @property {() => Promise<void>} close 离开房间并释放资源
 * @property {() => boolean} toggleMute 切换静音，返回静音后为 true
 * @property {() => boolean} toggleVideo 开关摄像头，返回关闭后为 true
 * @property {() => Promise<boolean>} [toggleScreen] 开关屏幕共享，返回共享中为 true
 * @property {() => number[]} [getAudioLevels]
 * @property {() => 'av' | 'audio' | 'video'} [getMediaMode]
 */
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
	return buildChatAvRelayWsUrl(buildAvRelayRoomId(groupId, channelId))
}

/**
 * @param {AudioContext} audioContext 播放上下文
 * @param {AudioData} audioData 解码音频
 * @param {{ audioNextTime: number }} peer 远端 peer（写入下一帧调度时间）
 * @param {Map<string, { analyser: AnalyserNode | null, levels: number[] }>} [levelsMap]
 * @param {string} [senderIdHex]
 * @returns {void}
 */
function scheduleAudioPlayback(audioContext, audioData, peer, levelsMap = null, senderIdHex = '') {
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
	const analyser = audioContext.createAnalyser()
	analyser.fftSize = 256
	const gain = audioContext.createGain()
	const source = audioContext.createBufferSource()
	source.buffer = buffer
	source.connect(gain)
	gain.connect(analyser)
	analyser.connect(audioContext.destination)
	const now = audioContext.currentTime
	const start = Math.max(now, peer.audioNextTime || now)
	source.start(start)
	peer.audioNextTime = start + buffer.duration
	peer.analyser = analyser
	if (levelsMap && senderIdHex)
		levelsMap.set(senderIdHex, { analyser, levels: [] })
}

/**
 * @param {object} opts 入参
 * @param {string} opts.groupId 群 ID
 * @param {string} opts.channelId 频道 ID
 * @param {keyof typeof CODECS_PRESETS} [opts.presetKey] 画质预设
 * @param {HTMLElement} opts.avGrid 远端 tile 容器
 * @param {HTMLVideoElement | null} [opts.videoLocal] 本地预览
 * @param {(count: number) => void} [opts.onPeerCount] 在线人数
 * @param {string} [opts.wsUrl] 自定义 WS（通话走 `/call/…`）
 * @param {(peers: { entityHash: string, senderId: string }[]) => void} [opts.onRoster] roster 回调
 * @param {(senderId: string, entityHash: string | null) => string} [opts.labelForPeer] tile 标签
 * @returns {Promise<CodecsAvSession>} 会话句柄
 */
export async function joinCodecsAvRoom(opts) {
	const mediaMode = opts.media || 'av'
	if (mediaMode !== 'video' && !('AudioEncoder' in window))
		throw new Error('WebCodecs not supported')
	if (mediaMode !== 'audio' && !('VideoEncoder' in window))
		throw new Error('WebCodecs not supported')

	const {
		groupId,
		channelId,
		presetKey = 'med',
		avGrid,
		videoLocal = null,
		onPeerCount,
		wsUrl = null,
		onRoster = null,
		labelForPeer = null,
		media: mediaMode = 'av',
	} = opts

	const wantsVideo = mediaMode !== 'audio'
	const wantsAudio = mediaMode !== 'video'

	await leaveCodecsAvRoom()

	const preset = CODECS_PRESETS[presetKey] || CODECS_PRESETS.med
	const selfId = crypto.getRandomValues(new Uint8Array(16))
	const selfHex = bytesToHex(selfId)
	const t0 = performance.now()
	const videoSeqRef = { seq: 0 }
	const audioSeqRef = { seq: 0 }
	const screenSeqRef = { seq: 0 }
	/** @type {Map<string, string>} senderId → entityHash */
	const senderToEntity = new Map()

	/** @type {Map<string, object | null>} */
	const remoteMeta = new Map()
	/** @type {Map<string, { analyser: AnalyserNode | null, levels: number[] }>} */
	const peerAudioLevels = new Map()
	const audioGate = createAudioGate()
	/** @type {Map<string, object>} */
	const peers = new Map()
	/** @type {Map<string, Promise<object>>} */
	const peersCreating = new Map()
	ws.binaryType = 'arraybuffer'

	/**
	 * @param {string} senderIdHex 远端 senderId（32 位 hex）
	 * @param {boolean} [isScreen=false] 是否屏幕共享轨
	 * @returns {Promise<object>} peer 状态
	 */
	const getOrCreatePeer = async (senderIdHex, isScreen = false) => {
		const peerKey = isScreen ? `${senderIdHex}:screen` : senderIdHex
		if (peers.has(peerKey)) return peers.get(peerKey)
		if (peersCreating.has(peerKey)) return peersCreating.get(peerKey)

		const promise = (async () => {
			const canvas = document.createElement('canvas')
			canvas.width = preset.w
			canvas.height = preset.h
			const canvas2d = canvas.getContext('2d')

			const entityHash = senderToEntity.get(senderIdHex) || null
			const defaultLabel = isScreen
				? `🖥 …${senderIdHex.slice(-8)}`
				: `…${senderIdHex.slice(-8)}`
			const label = labelForPeer
				? labelForPeer(senderIdHex, entityHash) + (isScreen ? ' 🖥' : '')
				: defaultLabel
			const tile = await renderTemplate('hub/streaming/av_tile', {
				peerId: peerKey,
				label,
			})
			if (entityHash) tile.dataset.entityHash = entityHash
			tile.querySelector('.hub-streaming-av-canvas-host')?.appendChild(canvas)
			avGrid.appendChild(tile)

			const audioCtx = isScreen ? null : new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
			/** @type {object} */
			const peer = {
				tile,
				isScreen,
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

			if (!isScreen) {
				peer.audioDecoder = new AudioDecoder({
					/**
					 * @param {AudioData} audioData 解码音频
					 * @returns {void}
					 */
					output: audioData => {
						scheduleAudioPlayback(audioCtx, audioData, peer, peerAudioLevels, senderIdHex)
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
			}

			peers.set(peerKey, peer)
			peersCreating.delete(peerKey)
			return peer
		})()

		peersCreating.set(peerKey, promise)
		return promise
	}

	/**
	 * @param {ArrayBuffer} arrayBuffer 入站帧
	 * @returns {Promise<void>}
	 */
	const handleInboundFrame = async arrayBuffer => {
		const frame = unpackAvFrame(arrayBuffer)
		if (!frame || frame.sender === selfHex) return
		const isScreen = frame.frameType === FRAME_SCREEN
		const peer = await getOrCreatePeer(frame.sender, isScreen)

		if (frame.frameType === FRAME_AUDIO) {
			if (!peer.audioDecoder) return
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

		if (frame.frameType !== FRAME_VIDEO && frame.frameType !== FRAME_SCREEN) return
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
		if (wireMessage.type === 'roster' && Array.isArray(wireMessage.peers)) {
			for (const peer of wireMessage.peers) {
				const sid = String(peer.senderId || '').toLowerCase()
				const eh = String(peer.entityHash || '').toLowerCase()
				if (sid && eh) senderToEntity.set(sid, eh)
			}
			onRoster?.(wireMessage.peers)
		}
		if (wireMessage.type === 'publish_meta')
			remoteMeta.set(String(wireMessage.senderId || '').toLowerCase(), wireMessage)
		if (wireMessage.type === 'publish_meta_revoke')
			remoteMeta.delete(String(wireMessage.senderId || '').toLowerCase())
	}

	await new Promise((res, rej) => {
		/**
		 *
		 */
		ws.onopen = () => {
			try {
				ws.send(JSON.stringify({ type: 'hello', senderId: selfHex }))
				ws.send(JSON.stringify({
					type: 'publish_meta',
					senderId: selfHex,
					video: wantsVideo ? { codec: 'vp8', w: preset.w, h: preset.h } : null,
					audio: wantsAudio ? { codec: AUDIO_CODEC } : null,
				}))
			}
			catch { /* ignore */ }
			res()
		}
		ws.onerror = rej
	})

	/** @type {() => void} */
	let stopCapture = () => { }
	/** @type {() => void} */
	let stopScreen = () => { }
	let mediaStream = null
	let screenStream = null
	let videoEnabled = true
	let audioMuted = false
	let screenSharing = false

	try {
		stopCapture = await startCodecsCapture({
			preset,
			ws,
			selfId,
			t0,
			videoSeqRef,
			audioSeqRef,
			videoLocal,
			wantsVideo,
			wantsAudio,
			audioGate,
			/**
			 * @returns {boolean} 是否应发送摄像头轨
			 */
			isVideoSending: () => videoEnabled && ws.readyState === WebSocket.OPEN,
			/**
			 * @returns {boolean} 是否应发送麦克风轨
			 */
			isAudioSending: () => !audioMuted && ws.readyState === WebSocket.OPEN,
			/**
			 * @param {MediaStream} stream 本地采集流
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
			stopScreen()
			mediaStream?.getTracks().forEach(t => t.stop())
			screenStream?.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
			ws.close()
			for (const peer of peers.values()) {
				safeClose(peer.videoDecoder)
				safeClose(peer.audioDecoder)
				safeClose(peer.audioCtx)
				peer.tile.remove()
			}
			peers.clear()
		},
		/**
		 * @returns {boolean} 是否静音
		 */
		toggleMute: () => {
			audioMuted = !audioMuted
			const track = mediaStream?.getAudioTracks()[0]
			if (track) track.enabled = !audioMuted
			return audioMuted
		},
		/**
		 * @returns {boolean} 是否已关摄像头
		 */
		toggleVideo: () => {
			videoEnabled = !videoEnabled
			const track = mediaStream?.getVideoTracks()[0]
			if (track) track.enabled = videoEnabled
			return !videoEnabled
		},
		/**
		 * @returns {Promise<boolean>} 是否正在共享屏幕
		 */
		toggleScreen: async () => {
			if (screenSharing) {
				stopScreen()
				screenStream?.getTracks().forEach(t => t.stop())
				screenStream = null
				screenSharing = false
				return false
			}
			if (!navigator.mediaDevices?.getDisplayMedia)
				throw new Error('getDisplayMedia not supported')
			screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: { frameRate: preset.fps },
				audio: false,
			})
			screenSharing = true
			stopScreen = await startVideoEncoder({
				preset,
				stream: screenStream,
				ws,
				selfId,
				t0,
				videoSeqRef: screenSeqRef,
				/**
				 * @returns {boolean} 是否应发送屏幕轨
				 */
				isVideoSending: () => screenSharing && ws.readyState === WebSocket.OPEN,
				frameType: FRAME_SCREEN,
			})
			screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
				if (!screenSharing) return
				stopScreen()
				screenStream = null
				screenSharing = false
			})
			return true
		},
		getAudioLevels: (senderId = '') => {
			const sid = String(senderId || '').toLowerCase()
			const entry = peerAudioLevels.get(sid)
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
				return out
			}
			const lvl = audioGate.getLevel()
			return Array.from({ length: 16 }, (_, i) => lvl * (0.6 + 0.4 * Math.sin(i)))
		},
		getMediaMode: () => mediaMode,
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
		wantsVideo = true, wantsAudio = true, audioGate,
	} = opts

	const constraints = {}
	if (wantsVideo)
		constraints.video = { width: preset.w, height: preset.h, frameRate: preset.fps }
	if (wantsAudio)
		constraints.audio = {
			echoCancellation: true,
			noiseSuppression: true,
			sampleRate: AUDIO_SAMPLE_RATE,
			channelCount: AUDIO_CHANNELS,
		}
	const stream = await navigator.mediaDevices.getUserMedia(constraints)
	onStream(stream)
	if (videoLocal) {
		videoLocal.srcObject = stream
		videoLocal.muted = true
	}

	const stopVideo = wantsVideo ? await startVideoEncoder({
		preset, stream, ws, selfId, t0, videoSeqRef, isVideoSending,
	}) : () => { }
	const stopAudio = wantsAudio ? await startAudioEncoder({
		stream, ws, selfId, t0, audioSeqRef, isAudioSending, audioGate,
	}) : () => { }

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
	const { preset, stream, ws, selfId, t0, videoSeqRef, isVideoSending, frameType = FRAME_VIDEO } = opts
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
			ws.send(packAvFrame(frameType, chunk.type === 'key', raw, selfId, t0, videoSeqRef))
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
		safeClose(encoder)
	}
}

/**
 * @param {object} opts 音频编码参数
 * @returns {Promise<() => void>} 停止音频编码函数
 */
async function startAudioEncoder(opts) {
	const { stream, ws, selfId, t0, audioSeqRef, isAudioSending, audioGate } = opts
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
			ws.send(packAvFrame(FRAME_AUDIO, chunk.type === 'key', raw, selfId, t0, audioSeqRef))
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
				if (isAudioSending() && (!audioGate || audioGate.update(audioData))) encoder.encode(audioData)
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
		safeClose(encoder)
	}
}
