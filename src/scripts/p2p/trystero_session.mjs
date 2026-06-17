import { buildIdentityAnnounce, verifyIdentityAnnounce } from './identity_announce.mjs'

/**
 * 将 @trystero-p2p 0.25 原生 room 适配为 fount 内部统一契约（适配集中在 joinMqttRoom 单一边界，
 * 房间消费方无需感知底层 API 形态）：
 * - 原生 `makeAction(name)` 返回对象 `{ send, onMessage }`、`send(data, { target })`、入站 handler 第二参为 `{ peerId }`；
 *   适配为 `[send(payload, peerId?), onMessage(handler)]`，handler 签名 `(payload, peerId)`。
 * - 原生 `onPeerJoin` / `onPeerLeave` 为单槽可赋值属性；适配为可多订阅（fan-out）的注册函数。
 * @param {object} raw 原生 Trystero room
 * @returns {object} fount 适配后的 room
 */
export function wrapTrysteroRoom(raw) {
	/** @type {Set<(peerId: string) => void>} */
	const joinCbs = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const leaveCbs = new Set()
	/**
	 * 单槽 onPeer* 属性 → 多订阅 fan-out 派发。
	 * @param {Set<(peerId: string) => void>} cbs 订阅集合
	 * @param {string} peerId peer id
	 * @returns {void}
	 */
	function dispatchPeerEvent(cbs, peerId) {
		for (const cb of cbs) try { cb(peerId) } catch (error) { console.error('trystero peer event handler failed', error) }
	}
	/**
	 * @param {string} peerId 加入的 peer id
	 * @returns {void}
	 */
	function onPeerJoinDispatch(peerId) { dispatchPeerEvent(joinCbs, peerId) }
	/**
	 * @param {string} peerId 离开的 peer id
	 * @returns {void}
	 */
	function onPeerLeaveDispatch(peerId) { dispatchPeerEvent(leaveCbs, peerId) }
	raw.onPeerJoin = onPeerJoinDispatch
	raw.onPeerLeave = onPeerLeaveDispatch

	return {
		raw,
		/**
		 * @param {string} name action 名
		 * @returns {[(payload: unknown, peerId?: string | string[] | null) => void, (handler: (payload: unknown, peerId: string) => void) => void]} [send, onMessage]
		 */
		makeAction(name) {
			const action = raw.makeAction(name)
			/**
			 * @param {unknown} payload 载荷
			 * @param {string | string[] | null} [peerId] 目标 peer；空为广播
			 * @returns {void}
			 */
			const send = (payload, peerId = null) => {
				Promise.resolve(action.send(payload, peerId == null ? undefined : { target: peerId }))
					.catch(error => console.warn(`trystero action "${name}" send failed`, error))
			}
			/**
			 * @param {(payload: unknown, peerId: string) => void} handler 入站处理器
			 * @returns {void}
			 */
			const onMessage = handler => {
				/**
				 * @param {unknown} data 载荷
				 * @param {{ peerId?: string }} [context] 入站上下文
				 * @returns {void | Promise<void>} handler 结果
				 */
				const receive = (data, context) => handler(data, context?.peerId)
				action.onMessage = receive
			}
			return [send, onMessage]
		},
		/**
		 * @param {(peerId: string) => void} cb 订阅回调
		 * @returns {() => void} 取消订阅
		 */
		onPeerJoin(cb) { joinCbs.add(cb); return () => joinCbs.delete(cb) },
		/**
		 * @param {(peerId: string) => void} cb 订阅回调
		 * @returns {() => void} 取消订阅
		 */
		onPeerLeave(cb) { leaveCbs.add(cb); return () => leaveCbs.delete(cb) },
		/** @returns {Record<string, RTCPeerConnection>} 当前 peer 连接表 */
		getPeers() { return raw.getPeers() },
		/**
		 * @param {string} id peer id
		 * @returns {Promise<number>} RTT 毫秒
		 */
		ping(id) { return raw.ping(id) },
		/** @returns {Promise<void>} 离开房间 */
		leave() { return raw.leave() },
	}
}

/**
 * Trystero action 显式注册表：register / send / on 分离。
 */
export class TrysteroActionRegistry {
	/** @type {Map<string, { send: Function, get: Function }>} */
	#entries = new Map()

	/**
	 * @param {object} room Trystero room
	 */
	constructor(room) {
		this.room = room
	}

	/**
	 * 连接建立时预注册 action，避免懒加载导致早期入站丢失。
	 * @param {string | string[]} names action 名或列表
	 * @returns {TrysteroActionRegistry} this
	 */
	register(names) {
		const list = Array.isArray(names) ? names : [names]
		for (const name of list)
			this.#ensureEntry(name)
		return this
	}

	/**
	 * @param {string} name action 名
	 * @returns {{ send: Function, get: Function }} entry
	 */
	#ensureEntry(name) {
		let entry = this.#entries.get(name)
		if (!entry) {
			const [send, get] = this.room.makeAction(name)
			entry = { send, get }
			this.#entries.set(name, entry)
		}
		return entry
	}

	/**
	 * @param {string} name action 名
	 * @returns {Function} send
	 */
	sender(name) {
		return this.#ensureEntry(name).send
	}

	/**
	 * @param {string} name action 名
	 * @returns {Function} onData 注册函数
	 */
	receiver(name) {
		return this.#ensureEntry(name).get
	}

	/**
	 * @param {string} name action 名
	 * @param {unknown} payload 载荷
	 * @param {string | null} [peerId] 目标 peer
	 * @returns {void}
	 */
	send(name, payload, peerId = null) {
		this.sender(name)(payload, peerId)
	}

	/**
	 * @param {string} name action 名
	 * @param {(payload: unknown, peerId: string) => void} handler 入站处理器
	 * @returns {TrysteroActionRegistry} this
	 */
	on(name, handler) {
		this.receiver(name)(handler)
		return this
	}
}

/**
 * @param {object} room Trystero room
 * @returns {TrysteroActionRegistry} action 注册表
 */
export function createTrysteroActionRegistry(room) {
	return new TrysteroActionRegistry(room)
}

/**
 * @returns {{ peerToNode: Map<string, string>, nodeToPeer: Map<string, string>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string | undefined }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, onPeerLeave: (peerId: string) => void }} peer 映射
 */
export function createPeerIdentityMaps() {
	/** @type {Map<string, string>} */
	const peerToNode = new Map()
	/** @type {Map<string, string>} */
	const nodeToPeer = new Map()

	return {
		peerToNode,
		nodeToPeer,
		/**
		 * @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster
		 */
		getRoster() {
			return [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
		},
		/**
		 * @param {string} targetNodeHash 64 hex
		 * @returns {string | null} peer id
		 */
		getPeerIdByNodeHash(targetNodeHash) {
			return nodeToPeer.get(String(targetNodeHash).trim().toLowerCase()) || null
		},
		/**
		 * @param {string} peerId Trystero peer
		 * @returns {void}
		 */
		onPeerLeave(peerId) {
			const remote = peerToNode.get(peerId)
			if (remote) nodeToPeer.delete(remote)
			peerToNode.delete(peerId)
		},
	}
}

/**
 * @param {object} room Trystero room
 * @param {ReturnType<typeof createPeerIdentityMaps>} maps peer 映射
 * @param {TrysteroActionRegistry} actions action 表
 * @returns {void}
 */
export function attachIdentityAnnounceHandlers(room, maps, actions) {
	actions.on('identity_announce', (payload, peerId) => {
		void verifyIdentityAnnounce(payload, peerId).then(remoteNodeHash => {
			if (!remoteNodeHash) return
			const previous = maps.peerToNode.get(peerId)
			if (previous) maps.nodeToPeer.delete(previous)
			maps.peerToNode.set(peerId, remoteNodeHash)
			maps.nodeToPeer.set(remoteNodeHash, peerId)
		})
	})

	room.onPeerJoin(peerId => {
		void buildIdentityAnnounce(peerId)
			.then(body => { actions.send('identity_announce', body, peerId) })
			.catch(() => { /* ignore */ })
	})

	room.onPeerLeave(peerId => {
		maps.onPeerLeave(peerId)
	})
}

/**
 * @param {unknown} data federation 设置
 * @returns {string[] | undefined} WSS relay URL 列表
 */
export function parseRelayUrls(data) {
	return Array.isArray(data?.relayUrls)
		? data.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
		: undefined
}
