/**
 * 流媒体频道：多方 WebRTC 网状拓扑 + TURN 支持
 *
 * 信令约定（通过群 WS broadcast）：
 *   { type: 'webrtc_signal', channelId, from, to?, signal: { type, sdp?, candidate? } }
 *   signal.type: 'peer_announce' | 'offer' | 'answer' | 'candidate' | 'peer_leave'
 *
 * 每加入一个新成员：已在线成员向新成员发 offer；新成员回 answer；双方交换 candidate。
 */

/** @param {unknown} e 来自 HTMLMediaElement.play() 的拒绝原因 */
function rethrowUnlessPlayPreempted(e) {
	if (e instanceof DOMException && (
		e.name === 'NotAllowedError' ||
		e.name === 'AbortError' ||
		e.name === 'NotSupportedError'
	)) return
	if (e?.name === 'AbortError') return
	throw e
}

/** @param {unknown} e 群广播 fetch 的拒绝原因 */
function rethrowUnlessAvSignalingAborted(e) {
	if (e?.name === 'AbortError') return
	throw e
}

/** @param {unknown} e addIceCandidate 的拒绝原因 */
function rethrowUnlessIceCandidateNoise(e) {
	const n = e?.name
	if (n === 'OperationError' || n === 'InvalidStateError' || n === 'InvalidAccessError') return
	throw e
}

/**
 * 获取 ICE 服务器配置（STUN + 公共 TURN 兜底）
 * @returns {RTCIceServer[]} ICE 服务器列表（用于 RTCPeerConnection）
 */
function getIceServers() {
	return [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' },
		// 开放中继 TURN（无鉴权，NAT 穿透兜底；生产建议自建）
		{
			urls: 'turn:openrelay.metered.ca:80',
			username: 'openrelayproject',
			credential: 'openrelayproject',
		},
		{
			urls: 'turn:openrelay.metered.ca:443',
			username: 'openrelayproject',
			credential: 'openrelayproject',
		},
	]
}

/**
 * 为指定 peerId 创建或获取视频容器块。
 * @param {string} peerId 对等方 ID（与信令 from 一致）
 * @param {HTMLElement} avGrid AV 网格容器
 * @returns {{ container: HTMLElement, video: HTMLVideoElement } | null} 瓦片与 video 元素；失败时为 null
 */
function getOrCreatePeerTile(peerId, avGrid) {
	if (!avGrid) return null
	let tile = avGrid.querySelector(`[data-peer-id="${CSS.escape(peerId)}"]`)
	if (tile) {
		const video = tile.querySelector('video')
		if (!video) return null
		return { container: tile, video }
	}

	tile = document.createElement('div')
	tile.className = 'av-tile relative rounded-lg overflow-hidden bg-black cursor-pointer min-h-0'
	tile.dataset.peerId = peerId

	const video = document.createElement('video')
	video.autoplay = true
	video.playsInline = true
	video.className = 'w-full h-full object-cover'
	tile.appendChild(video)

	const label = document.createElement('div')
	label.className = 'absolute bottom-1 left-1 text-xs text-white bg-black/50 rounded px-1'
	label.textContent = peerId.slice(0, 8)
	tile.appendChild(label)

	tile.addEventListener('click', () => toggleMainView(tile, avGrid))
	avGrid.appendChild(tile)

	updateGridLayout(avGrid)
	return { container: tile, video }
}

/**
 * 根据 tile 数量更新网格列数（内联样式，避免 Tailwind 动态类未打包）。
 * @param {HTMLElement} avGrid AV 网格容器
 * @returns {void}
 */
function updateGridLayout(avGrid) {
	if (!avGrid) return
	const count = avGrid.querySelectorAll('.av-tile').length
	let cols = count <= 1 ? 1 : count <= 4 ? 2 : 3
	if (avGrid.querySelector('.av-tile-main'))
		cols = 1

	avGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`
}

/**
 * 切换主画面放大显示。
 * @param {HTMLElement} tile 被点击的瓦片
 * @param {HTMLElement} avGrid AV 网格容器
 * @returns {void}
 */
function toggleMainView(tile, avGrid) {
	const isMain = tile.classList.contains('av-tile-main')
	avGrid.querySelectorAll('.av-tile-main').forEach(t => {
		t.classList.remove('av-tile-main', 'col-span-full', 'row-span-2')
	})
	if (!isMain)
		tile.classList.add('av-tile-main', 'col-span-full', 'row-span-2')

	updateGridLayout(avGrid)
}

/**
 * @typedef {object} AvSession
 * @property {Map<string, RTCPeerConnection>} peers  peerId → RTCPeerConnection
 * @property {MediaStream} localStream
 * @property {() => boolean} toggleMute     切换麦克风静音，返回是否已静音
 * @property {() => boolean} toggleVideo    切换摄像头（主画面），返回是否已关闭
 * @property {(msg: object) => void} handleSignal  处理收到的 WS webrtc_signal 消息
 * @property {() => void} close             关闭会话，释放所有资源
 */

/**
 * 启动本地流媒体会话，并立即广播 peer_announce（告知其他在线成员）。
 * @param {object} p 会话参数对象
 * @param {string} p.channelId 流媒体频道 ID
 * @param {string} p.clientId 本机身份标识
 * @param {HTMLVideoElement | null} p.videoLocal 本地预览 video 元素
 * @param {HTMLElement | null} p.remoteContainer AV 网格容器（含本地 tile；每个远端 peer 动态追加 tile）
 * @param {(payload: object) => Promise<void>} p.broadcast 广播函数（调用群 WS broadcast 接口）
 * @returns {Promise<AvSession>} 音视频会话控制对象
 */
export async function startAvSession(p) {
	const { channelId, clientId, videoLocal, remoteContainer, broadcast } = p

	const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
	if (videoLocal) {
		videoLocal.srcObject = localStream
		videoLocal.muted = true
		videoLocal.play?.().catch(e => { rethrowUnlessPlayPreempted(e) })
	}

	if (remoteContainer) {
		updateGridLayout(remoteContainer)
		const localTile = remoteContainer.querySelector('[data-peer-id="local"]')
		if (localTile instanceof HTMLElement && !localTile.dataset.avTileClickBound) {
			localTile.dataset.avTileClickBound = '1'
			localTile.addEventListener('click', () => toggleMainView(localTile, remoteContainer))
		}
	}

	/** @type {Map<string, RTCPeerConnection>} */
	const peers = new Map()
	/** @type {Map<string, MediaStream>} */
	const remoteStreams = new Map()

	let audioMuted = false
	let videoDisabled = false

	/**
	 * 创建到指定 peer 的 RTCPeerConnection，绑定本地流与事件
	 * @param {string} peerId 远端对等方 ID
	 * @returns {RTCPeerConnection} 新建的 PeerConnection
	 */
	function createPc(peerId) {
		const pc = new RTCPeerConnection({ iceServers: getIceServers() })
		peers.set(peerId, pc)

		localStream.getTracks().forEach(t => pc.addTrack(t, localStream))

		/**
		 * 收到远端媒体轨道时挂载 video。
		 * @param {RTCTrackEvent} ev 轨道事件
		 * @returns {void}
		 */
		pc.ontrack = ev => {
			const stream = ev.streams[0]
			if (!stream || !remoteContainer) return
			remoteStreams.set(peerId, stream)
			const tileInfo = getOrCreatePeerTile(peerId, remoteContainer)
			if (!tileInfo) return
			const { video } = tileInfo
			video.srcObject = stream
			video.play?.().catch(e => { rethrowUnlessPlayPreempted(e) })
		}

		/**
		 * ICE 候选生成后通过信令广播给对方。
		 * @param {RTCPeerConnectionIceEvent} ev ICE 候选事件
		 * @returns {Promise<void>}
		 */
		pc.onicecandidate = async ev => {
			if (!ev.candidate) return
			const c = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
			await broadcast({
				type: 'webrtc_signal',
				channelId,
				from: clientId,
				to: peerId,
				signal: { type: 'candidate', candidate: c },
			}).catch(e => { rethrowUnlessAvSignalingAborted(e) })
		}

		/**
		 *
		 */
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
				removePeer(peerId)
		}

		return pc
	}

	/**
	 * 移除 peer 连接并清理远端 video 元素
	 * @param {string} peerId 对等方 ID
	 * @returns {void}
	 */
	function removePeer(peerId) {
		const pc = peers.get(peerId)
		if (pc) {
			pc.close()
			peers.delete(peerId)
		}
		remoteStreams.delete(peerId)
		const tile = remoteContainer?.querySelector(`[data-peer-id="${CSS.escape(peerId)}"]`)
		if (tile instanceof HTMLElement && tile.dataset.peerId !== 'local')
			tile.remove()
		if (remoteContainer) updateGridLayout(remoteContainer)
	}

	/**
	 * 向新加入的 peer 发起 offer
	 * @param {string} peerId 对等方 ID
	 * @returns {Promise<void>}
	 */
	async function initiateOffer(peerId) {
		if (peers.has(peerId)) return
		const pc = createPc(peerId)
		const offer = await pc.createOffer()
		await pc.setLocalDescription(offer)
		await broadcast({
			type: 'webrtc_signal',
			channelId,
			from: clientId,
			to: peerId,
			signal: { type: 'offer', sdp: pc.localDescription?.sdp },
		}).catch(e => { rethrowUnlessAvSignalingAborted(e) })
	}

	/**
	 * 处理收到的 WS webrtc_signal 消息
	 * @param {object} msg 信令消息体
	 * @returns {Promise<void>}
	 */
	async function handleSignal(msg) {
		if (msg.type !== 'webrtc_signal') return
		if (msg.channelId !== channelId) return
		const from = msg.from
		if (!from || from === clientId) return
		// 消息有 to 字段时只处理发给自己的
		if (msg.to && msg.to !== clientId) return
		const { signal } = msg

		if (signal?.type === 'peer_announce') {
			// 新成员广播，主动向其发 offer（避免双方同时发 offer：id 较小的一方发）
			if (clientId < from)
				await initiateOffer(from).catch(console.error)
			return
		}

		if (signal?.type === 'peer_leave') {
			removePeer(from)
			return
		}

		if (signal?.type === 'offer' && signal.sdp) {
			if (!peers.has(from)) createPc(from)
			const pc = peers.get(from)
			await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
			const answer = await pc.createAnswer()
			await pc.setLocalDescription(answer)
			await broadcast({
				type: 'webrtc_signal',
				channelId,
				from: clientId,
				to: from,
				signal: { type: 'answer', sdp: pc.localDescription?.sdp },
			}).catch(e => { rethrowUnlessAvSignalingAborted(e) })
			return
		}

		if (signal?.type === 'answer' && signal.sdp) {
			const pc = peers.get(from)
			if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(console.error)
			return
		}

		if (signal?.type === 'candidate' && signal.candidate) {
			const pc = peers.get(from)
			if (pc) {
				const cand = new RTCIceCandidate(signal.candidate)
				await pc.addIceCandidate(cand).catch(e => { rethrowUnlessIceCandidateNoise(e) })
			}
		}
	}

	// 广播自身加入，让其他在线成员向自己发 offer
	await broadcast({
		type: 'webrtc_signal',
		channelId,
		from: clientId,
		signal: { type: 'peer_announce' },
	}).catch(e => { rethrowUnlessAvSignalingAborted(e) })

	return {
		peers,
		localStream,
		/**
		 * 切换麦克风静音状态。
		 * @returns {boolean} 静音后为 true，否则 false
		 */
		toggleMute: () => {
			audioMuted = !audioMuted
			localStream.getAudioTracks().forEach(t => { t.enabled = !audioMuted })
			return audioMuted
		},
		/**
		 * 切换本地摄像头开关。
		 * @returns {boolean} 关闭视频后为 true，否则 false
		 */
		toggleVideo: () => {
			videoDisabled = !videoDisabled
			localStream.getVideoTracks().forEach(t => { t.enabled = !videoDisabled })
			return videoDisabled
		},
		handleSignal,
		/**
		 *
		 */
		close: async () => {
			await broadcast({
				type: 'webrtc_signal',
				channelId,
				from: clientId,
				signal: { type: 'peer_leave' },
			}).catch(e => { rethrowUnlessAvSignalingAborted(e) })
			for (const peerId of [...peers.keys()]) removePeer(peerId)
			remoteContainer?.querySelectorAll('.av-tile-main').forEach(t => {
				t.classList.remove('av-tile-main', 'col-span-full', 'row-span-2')
			})
			if (remoteContainer) updateGridLayout(remoteContainer)
			localStream.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
		},
	}
}
