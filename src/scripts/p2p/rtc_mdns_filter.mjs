/**
 * 服务端 WebRTC polyfill（werift / node-datachannel）在 Windows 等环境常产出 `.local` mDNS host candidate，
 * 远端无法解析。在 RTCPeerConnection 层将此类 candidate 改写为 127.0.0.1，替代 Trystero 内部测试 flag。
 */

/**
 * @param {string | null | undefined} candidateSdp ICE candidate SDP 行
 * @returns {string | null} 改写后的 SDP；无法改写时返回 null（丢弃）
 */
export function rewriteMdnsHostCandidateSdp(candidateSdp) {
	const sdp = String(candidateSdp || '').trim()
	if (!sdp || !/\.local/i.test(sdp)) return sdp || null
	if (!/\btyp host\b/i.test(sdp)) return sdp
	const rewritten = sdp.replace(/(\s)[\w-]+\.local(\s|$)/gi, '$1127.0.0.1$2')
	return rewritten === sdp ? null : rewritten
}

/**
 * @param {RTCIceCandidate | { candidate?: string } | null | undefined} candidate ICE candidate
 * @param {typeof RTCIceCandidate} RTCIceCandidateCtor 构造函数
 * @returns {RTCIceCandidate | { candidate?: string } | null | undefined} 过滤/改写后的 candidate
 */
export function filterMdnsIceCandidate(candidate, RTCIceCandidateCtor) {
	if (!candidate) return candidate
	const raw = typeof candidate === 'string'
		? candidate
		: candidate.candidate ?? candidate.toJSON?.()?.candidate ?? ''
	const rewritten = rewriteMdnsHostCandidateSdp(raw)
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
 * @returns {typeof RTCPeerConnection} 包装后的 RTCPeerConnection 类
 */
export function wrapRtcPeerConnectionForMdns(BaseRTC, RTCIceCandidate = globalThis.RTCIceCandidate) {
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
		const filtered = filterMdnsIceCandidate(event.candidate, RTCIceCandidate)
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
			// werift 走 onIceCandidate observable；与 onicecandidate 属性并行挂钩，避免仅包装 setter 时漏过滤。
			const iceObs = this.onIceCandidate
			if (iceObs && typeof iceObs.subscribe === 'function') {
				iceObs.subscribe(candidate => {
					if (!this.#userIceHandler) return
					if (!candidate) {
						this.#userIceHandler({ candidate: null })
						return
					}
					const filtered = filterMdnsIceCandidate(candidate, RTCIceCandidate)
					if (filtered)
						this.#userIceHandler({ candidate: filtered })
				})
			}
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
