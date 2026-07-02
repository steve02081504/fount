/**
 * 服务端 WebRTC polyfill（werift / node-datachannel）在 Windows 等环境常产出 `.local` mDNS host candidate，
 * 远端无法解析。按策略改写为 loopback 或丢弃。
 */

/** @typedef {'none' | 'rewrite-loopback' | 'drop'} MdnsCandidatePolicy */

/**
 * @param {string | null | undefined} candidateSdp ICE candidate SDP 行
 * @param {MdnsCandidatePolicy} policy 处理策略
 * @returns {string | null} 处理后的 SDP；drop 策略下不可用时返回 null
 */
export function applyMdnsHostCandidatePolicy(candidateSdp, policy) {
	const sdp = String(candidateSdp || '').trim()
	if (!sdp || !/\.local/i.test(sdp)) return sdp || null
	if (!/\btyp host\b/i.test(sdp)) return sdp
	if (policy === 'drop') return null
	if (policy === 'rewrite-loopback') {
		const rewritten = sdp.replace(/(\s)[\w-]+\.local(\s|$)/gi, '$1127.0.0.1$2')
		return rewritten === sdp ? null : rewritten
	}
	return sdp
}

/**
 * @param {RTCIceCandidate | { candidate?: string } | null | undefined} candidate ICE candidate
 * @param {typeof RTCIceCandidate} RTCIceCandidateCtor 构造函数
 * @param {MdnsCandidatePolicy} policy 处理策略
 * @returns {RTCIceCandidate | { candidate?: string } | null | undefined} 过滤/改写后的 candidate
 */
export function filterMdnsIceCandidate(candidate, RTCIceCandidateCtor, policy) {
	if (!candidate || policy === 'none') return candidate
	const raw = typeof candidate === 'string'
		? candidate
		: candidate.candidate ?? candidate.toJSON?.()?.candidate ?? ''
	const rewritten = applyMdnsHostCandidatePolicy(raw, policy)
	if (!rewritten) return null
	if (rewritten === raw) return candidate
	try {
		const init = typeof candidate.toJSON === 'function'
			? { ...candidate.toJSON(), candidate: rewritten }
			: { candidate: rewritten, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex }
		return new RTCIceCandidateCtor(init)
	}
	catch {
		return { ...candidate, candidate: rewritten }
	}
}

/**
 * @param {typeof RTCPeerConnection} BaseRTC 原始 polyfill 类
 * @param {typeof RTCIceCandidate} [RTCIceCandidate] ICE candidate 构造函数
 * @param {MdnsCandidatePolicy} [policy='drop'] mDNS 策略
 * @returns {typeof RTCPeerConnection} 包装后的 RTCPeerConnection 类（none 时原样返回）
 */
export function wrapRtcPeerConnectionForMdns(BaseRTC, RTCIceCandidate = globalThis.RTCIceCandidate, policy = 'drop') {
	if (policy === 'none') return BaseRTC

	/**
	 * @param {RTCPeerConnectionIceEvent} event ICE 事件
	 * @param {(event: RTCPeerConnectionIceEvent) => void} handler 用户 handler
	 * @returns {void}
	 */
	function invokeFilteredIceHandler(event, handler) {
		if (!event?.candidate) {
			handler(event)
			return
		}
		const filtered = filterMdnsIceCandidate(event.candidate, RTCIceCandidate, policy)
		if (!filtered) return
		if (filtered === event.candidate) {
			handler(event)
			return
		}
		handler({ ...event, candidate: filtered })
	}

	return class MdnsFilteredRTCPeerConnection extends BaseRTC {
		/** @type {((event: RTCPeerConnectionIceEvent) => void) | null} */
		#userIceHandler = null

		/**
		 * @param {RTCConfiguration} [config] RTC 配置
		 */
		constructor(config) {
			super(config)
			/** @param {RTCPeerConnectionIceEvent} event ICE 事件 */
			const relayIce = event => {
				if (this.#userIceHandler)
					invokeFilteredIceHandler(event, this.#userIceHandler)
			}
			super.onicecandidate = relayIce
			const iceObs = this.onIceCandidate
			if (iceObs && typeof iceObs.subscribe === 'function') 
				iceObs.subscribe(candidate => {
					if (!this.#userIceHandler) return
					if (!candidate) {
						this.#userIceHandler({ candidate: null })
						return
					}
					const filtered = filterMdnsIceCandidate(candidate, RTCIceCandidate, policy)
					if (filtered)
						this.#userIceHandler({ candidate: filtered })
				})
			
		}

		/** @returns {((event: RTCPeerConnectionIceEvent) => void) | null} 用户 ICE handler */
		get onicecandidate() {
			return this.#userIceHandler
		}

		/** @param {((event: RTCPeerConnectionIceEvent) => void) | null} handler ICE handler */
		set onicecandidate(handler) {
			this.#userIceHandler = handler
		}
	}
}
