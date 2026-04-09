/**
 * 群流媒体：多方 WebRTC 网状拓扑 + TURN 支持
 *
 * 信令约定（通过群 WS broadcast）：
 *   { type: 'webrtc_signal', channelId, from, to?, signal: { type, sdp?, candidate? } }
 *   signal.type: 'peer_announce' | 'offer' | 'answer' | 'candidate' | 'peer_leave'
 *
 * 每加入一个新成员：已在线成员向新成员发 offer；新成员回 answer；双方交换 candidate。
 */

/**
 * 获取 ICE 服务器配置（STUN + 公共 TURN 兜底）
 * @returns {RTCIceServer[]}
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
 * @param {object} p
 * @param {string} p.channelId
 * @param {string} p.clientId   本机身份标识
 * @param {HTMLVideoElement | null} p.videoLocal
 * @param {HTMLElement | null} p.remoteContainer  远端视频挂载容器（每个远端 peer 添加一个 <video>）
 * @param {(payload: object) => Promise<void>} p.broadcast  广播函数（调用群 WS broadcast 接口）
 * @returns {Promise<AvSession>}
 */
export async function startGroupAv(p) {
	const { channelId, clientId, videoLocal, remoteContainer, broadcast } = p

	const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
	if (videoLocal) {
		videoLocal.srcObject = localStream
		videoLocal.muted = true
		videoLocal.play?.().catch(() => {})
	}

	/** @type {Map<string, RTCPeerConnection>} */
	const peers = new Map()
	/** @type {Map<string, MediaStream>} */
	const remoteStreams = new Map()

	let audioMuted = false
	let videoDisabled = false

	/**
	 * 创建到指定 peer 的 RTCPeerConnection，绑定本地流与事件
	 * @param {string} peerId
	 * @returns {RTCPeerConnection}
	 */
	function createPc(peerId) {
		const pc = new RTCPeerConnection({ iceServers: getIceServers() })
		peers.set(peerId, pc)

		localStream.getTracks().forEach(t => pc.addTrack(t, localStream))

		pc.ontrack = ev => {
			const stream = ev.streams[0]
			if (!stream || !remoteContainer) return
			remoteStreams.set(peerId, stream)
			let vid = remoteContainer.querySelector(`[data-peer="${CSS.escape(peerId)}"]`)
			if (!vid) {
				vid = document.createElement('video')
				vid.dataset.peer = peerId
				vid.autoplay = true
				vid.playsInline = true
				vid.className = 'rounded-lg w-full max-h-40 object-cover bg-base-300'
				remoteContainer.appendChild(vid)
			}
			vid.srcObject = stream
			vid.play?.().catch(() => {})
		}

		pc.onicecandidate = async ev => {
			if (!ev.candidate) return
			const c = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
			await broadcast({
				type: 'webrtc_signal',
				channelId,
				from: clientId,
				to: peerId,
				signal: { type: 'candidate', candidate: c },
			}).catch(() => {})
		}

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				removePeer(peerId)
			}
		}

		return pc
	}

	/**
	 * 移除 peer 连接并清理远端 video 元素
	 * @param {string} peerId
	 */
	function removePeer(peerId) {
		const pc = peers.get(peerId)
		if (pc) {
			try { pc.close() }
			catch { /* ignore */ }
			peers.delete(peerId)
		}
		remoteStreams.delete(peerId)
		const vid = remoteContainer?.querySelector(`[data-peer="${CSS.escape(peerId)}"]`)
		vid?.remove()
	}

	/**
	 * 向新加入的 peer 发起 offer
	 * @param {string} peerId
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
		}).catch(() => {})
	}

	/**
	 * 处理收到的 WS webrtc_signal 消息
	 * @param {object} msg
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
			}).catch(() => {})
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
				await pc.addIceCandidate(cand).catch(() => {})
			}
		}
	}

	// 广播自身加入，让其他在线成员向自己发 offer
	await broadcast({
		type: 'webrtc_signal',
		channelId,
		from: clientId,
		signal: { type: 'peer_announce' },
	}).catch(() => {})

	return {
		peers,
		localStream,
		toggleMute: () => {
			audioMuted = !audioMuted
			localStream.getAudioTracks().forEach(t => { t.enabled = !audioMuted })
			return audioMuted
		},
		toggleVideo: () => {
			videoDisabled = !videoDisabled
			localStream.getVideoTracks().forEach(t => { t.enabled = !videoDisabled })
			return videoDisabled
		},
		handleSignal,
		close: async () => {
			await broadcast({
				type: 'webrtc_signal',
				channelId,
				from: clientId,
				signal: { type: 'peer_leave' },
			}).catch(() => {})
			for (const peerId of peers.keys()) removePeer(peerId)
			localStream.getTracks().forEach(t => t.stop())
			if (videoLocal) videoLocal.srcObject = null
		},
	}
}
