import { buildIdentityAnnounce, verifyIdentityAnnounce } from './identity_announce.mjs'

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
 * @param {string} username replica 登录名
 * @param {ReturnType<typeof createPeerIdentityMaps>} maps peer 映射
 * @param {TrysteroActionRegistry} actions action 表
 * @returns {void}
 */
export function attachIdentityAnnounceHandlers(room, username, maps, actions) {
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
		void buildIdentityAnnounce(username, peerId)
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
