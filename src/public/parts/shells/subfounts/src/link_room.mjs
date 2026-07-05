import { advertiseTopic, subscribeTopic } from '../../../../../scripts/p2p/discovery/index.mjs'
import { buildSignedAdvert, verifySignedAdvert } from '../../../../../scripts/p2p/link/handshake.mjs'
import {
	groupRendezvousTopic,
	decryptSignalPacket,
	encryptSignalPacket,
	getLinkRegistry,
} from '../../../../../scripts/p2p/link_registry.mjs'

/**
 * 在指定 scope 与 roomSecret 下创建 link 层房间（discovery + registry 转发）。
 * @param {object} opts 房间选项
 * @param {string} opts.scope link registry scope（如 `group:{id}`）
 * @param {string} opts.roomSecret 房间 rendezvous 密钥
 * @param {(nodeHash: string) => boolean} [opts.allowNode] 是否允许与某 nodeHash 通信
 * @returns {{ start: () => Promise<void>, leave: () => Promise<void>, makeAction: (name: string) => [(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void], onPeerJoin: (cb: (peerId: string) => void) => () => void, onPeerLeave: (cb: (peerId: string) => void) => () => void, getPeers: () => Record<string, true> }} 房间句柄
 */
export function createScopedLinkRoom(opts) {
	const registry = getLinkRegistry()
	const scope = String(opts.scope)
	const topic = groupRendezvousTopic(opts.roomSecret)
	const allowNode = typeof opts.allowNode === 'function' ? opts.allowNode : () => true
	/** @type {Set<string>} */
	const discoveredPeers = new Set()
	/** @type {Set<string>} */
	const announcedPeers = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const joinListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const leaveListeners = new Set()
	/** @type {Set<() => void>} */
	const cleanups = new Set()
	/** @type {Map<string, { handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }>} */
	const actionEntries = new Map()

	/**
	 * @returns {string[]} 当前已连接且通过 allowNode 过滤的 peer nodeHash 列表
	 */
	function activePeerIds() {
		return [...discoveredPeers].filter(nodeHash => allowNode(nodeHash) && registry.getLink(nodeHash))
	}

	/**
	 * @param {Set<(peerId: string) => void>} listeners 回调集合
	 * @param {string} peerId 节点 hash
	 * @returns {void}
	 */
	function emit(listeners, peerId) {
		for (const listener of listeners)
			try { listener(peerId) } catch { /* ignore */ }
	}

	/**
	 * @param {string} peerId 节点 hash
	 * @returns {void}
	 */
	function notePeerJoin(peerId) {
		if (!peerId || announcedPeers.has(peerId)) return
		announcedPeers.add(peerId)
		emit(joinListeners, peerId)
	}

	/**
	 * @param {string} peerId 节点 hash
	 * @returns {void}
	 */
	function notePeerLeave(peerId) {
		if (!peerId || !announcedPeers.has(peerId)) return
		announcedPeers.delete(peerId)
		emit(leaveListeners, peerId)
	}

	/**
	 * @param {string} name action 名称
	 * @returns {{ handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }} action 槽（含待处理 backlog）
	 */
	function getActionEntry(name) {
		const key = String(name)
		if (!actionEntries.has(key))
			actionEntries.set(key, { handler: null, backlog: [] })
		return actionEntries.get(key)
	}

	return {
		/**
		 * @returns {Promise<void>}
		 */
		async start() {
			cleanups.add(registry.subscribeScope(scope, (senderNodeHash, envelope) => {
				if (!allowNode(senderNodeHash)) return
				const entry = actionEntries.get(String(envelope?.action || ''))
				if (!entry) return
				if (entry.handler) entry.handler(envelope.payload, senderNodeHash)
				else entry.backlog.push({ payload: envelope.payload, peerId: senderNodeHash })
			}))
			cleanups.add(registry.onLinkUp(nodeHash => {
				if (!discoveredPeers.has(nodeHash) || !allowNode(nodeHash)) return
				notePeerJoin(nodeHash)
			}))
			cleanups.add(registry.onLinkDown(nodeHash => {
				if (!discoveredPeers.has(nodeHash)) return
				notePeerLeave(nodeHash)
			}))
			cleanups.add(await subscribeTopic(topic, async bytes => {
				const packet = decryptSignalPacket(topic, bytes)
				if (packet?.type !== 'advert' || !packet.body) return
				const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
				if (!verifiedNodeHash || !allowNode(verifiedNodeHash)) return
				discoveredPeers.add(verifiedNodeHash)
				await registry.ensureLinkToNode(verifiedNodeHash).catch(() => null)
				if (registry.getLink(verifiedNodeHash)) notePeerJoin(verifiedNodeHash)
			}))
			cleanups.add(await advertiseTopic(topic, encryptSignalPacket(topic, {
				type: 'advert',
				body: await buildSignedAdvert(topic, Date.now(), registry.localIdentity),
			})))
			for (const peerId of activePeerIds())
				notePeerJoin(peerId)
		},
		/**
		 * @returns {Promise<void>}
		 */
		async leave() {
			for (const cleanup of cleanups)
				try { cleanup() } catch { /* ignore */ }
			cleanups.clear()
			for (const peerId of [...announcedPeers])
				notePeerLeave(peerId)
		},
		/**
		 * @param {string} name action 名称
		 * @returns {[(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void]} [send, onReceive] 发送与订阅元组
		 */
		makeAction(name) {
			const actionName = String(name)
			return [
				async (payload, peerId = null) => {
					if (Array.isArray(peerId)) {
						await Promise.all(peerId.map(targetPeerId =>
							registry.sendToNodeLink(targetPeerId, { scope, action: actionName, payload })))
						return
					}
					if (peerId)
						await registry.sendToNodeLink(peerId, { scope, action: actionName, payload })
					else
						await Promise.all(activePeerIds().map(targetPeerId =>
							registry.sendToNodeLink(targetPeerId, { scope, action: actionName, payload })))
				},
				handler => {
					const entry = getActionEntry(actionName)
					entry.handler = handler
					for (const pending of entry.backlog.splice(0))
						handler(pending.payload, pending.peerId)
				},
			]
		},
		/**
		 * @param {(peerId: string) => void} cb 新 peer 上线回调
		 * @returns {() => void} 取消订阅
		 */
		onPeerJoin(cb) {
			joinListeners.add(cb)
			for (const peerId of activePeerIds())
				announcedPeers.add(peerId)
			for (const peerId of announcedPeers)
				try { cb(peerId) } catch { /* ignore */ }
			return () => joinListeners.delete(cb)
		},
		/**
		 * @param {(peerId: string) => void} cb peer 离线回调
		 * @returns {() => void} 取消订阅
		 */
		onPeerLeave(cb) {
			leaveListeners.add(cb)
			return () => leaveListeners.delete(cb)
		},
		/**
		 * @returns {Record<string, true>} 当前活跃 peer 的 nodeHash 集合
		 */
		getPeers() {
			return Object.fromEntries(activePeerIds().map(peerId => [peerId, true]))
		},
	}
}
