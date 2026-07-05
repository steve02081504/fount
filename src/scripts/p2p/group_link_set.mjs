import { advertiseTopic, subscribeTopic } from './discovery/index.mjs'
import { buildSignedAdvert, verifySignedAdvert } from './link/handshake.mjs'
import {
	groupRendezvousTopic,
	decryptSignalPacket,
	encryptSignalPacket,
	getLinkRegistry,
} from './link_registry.mjs'

/**
 * 创建基于 link registry 的群组联邦房间。
 * @param {object} opts 选项
 * @param {string} opts.groupId 群组 id
 * @param {string} opts.roomSecret 房间密钥（用于 rendezvous topic）
 * @param {string[]} opts.members 初始成员 nodeHash 列表
 * @returns {{ groupId: string, scope: string, start: () => Promise<void>, leave: () => Promise<void>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, sendToPeer: (peerId: string, actionName: string, payload: unknown) => Promise<boolean>, send: (actionName: string, payload: unknown, peerId?: string | null) => Promise<number>, onEnvelope: (cb: (senderNodeHash: string, envelope: object) => void) => () => void, onPeerJoin: (cb: (peerId: string) => void) => () => void, onPeerLeave: (cb: (peerId: string) => void) => () => void, getPeers: () => Record<string, true>, makeAction: (name: string) => [(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void], registerCleanup: (fn: () => void) => void, isActive: () => boolean }} 群组 link set 接口
 */
export function createGroupLinkSet(opts) {
	const registry = opts.registry ?? getLinkRegistry()
	const autoconnect = opts.autoconnect !== false
	const groupId = String(opts.groupId)
	const scope = `group:${groupId}`
	const topic = groupRendezvousTopic(opts.roomSecret)
	const members = new Set((Array.isArray(opts.members) ? opts.members : []).map(String))
	const selfNodeHash = registry.localIdentity.nodeHash
	/** @type {Set<Function>} */
	const cleanups = new Set()
	/** @type {Set<Function>} */
	const envelopeListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const peerJoinListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const peerLeaveListeners = new Set()
	/** @type {Set<string>} */
	const announcedPeers = new Set()
	/** @type {Map<string, { handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }>} */
	const actionEntries = new Map()
	let active = true

	/**
	 * 注册 leave 时执行的清理回调。
	 * @param {() => void} fn 清理函数
	 * @returns {void}
	 */
	function registerCleanup(fn) {
		if (typeof fn !== 'function') return
		cleanups.add(fn)
	}

	/**
	 * 向 peer 事件监听器集合广播。
	 * @param {Set<(peerId: string) => void>} listeners 监听器集合
	 * @param {string} peerId 目标 peer id
	 * @returns {void}
	 */
	function emitPeerListeners(listeners, peerId) {
		for (const listener of listeners)
			try { listener(peerId) } catch { /* ignore */ }
	}

	/**
	 * 记录 peer 加入并通知监听器。
	 * @param {string} peerId 加入的 peer id
	 * @returns {void}
	 */
	function notePeerJoin(peerId) {
		if (!peerId || announcedPeers.has(peerId)) return
		announcedPeers.add(peerId)
		emitPeerListeners(peerJoinListeners, peerId)
	}

	/**
	 * 记录 peer 离开并通知监听器。
	 * @param {string} peerId 离开的 peer id
	 * @returns {void}
	 */
	function notePeerLeave(peerId) {
		if (!peerId || !announcedPeers.has(peerId)) return
		announcedPeers.delete(peerId)
		emitPeerListeners(peerLeaveListeners, peerId)
	}

	/**
	 * 将新发现的 nodeHash 加入成员集合并更新 scope 兴趣。
	 * @param {string} nodeHash 候选节点 64 hex
	 * @returns {void}
	 */
	function notePeerCandidate(nodeHash) {
		const normalized = String(nodeHash || '')
		if (!normalized || normalized === selfNodeHash || members.has(normalized)) return
		members.add(normalized)
		registry.registerScopeInterest(scope, [...members])
	}

	/**
	 * 获取或创建指定 action 的 handler/backlog 条目。
	 * @param {string} name action 名称
	 * @returns {{ handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }} action 条目
	 */
	function getActionEntry(name) {
		const key = String(name)
		if (!actionEntries.has(key))
			actionEntries.set(key, { handler: null, backlog: [] })
		return actionEntries.get(key)
	}

	/**
	 * 返回当前已连接且非自身的成员 roster。
	 * @returns {Array<{ peerId: string, remoteNodeHash: string }>} 在线成员列表
	 */
	function activeRoster() {
		return [...members]
			.filter(nodeHash => nodeHash !== selfNodeHash && registry.getLink(nodeHash))
			.map(nodeHash => ({ peerId: nodeHash, remoteNodeHash: nodeHash }))
	}

	/**
	 * 启动 discovery、scope 订阅与成员自动连接。
	 * @returns {Promise<void>}
	 */
	async function start() {
		// 房间就绪本身就意味着本节点应当可被发现；不能等到首次外拨 ensureLinkToNode 才懒启动 runtime，
		// 否则“只有自己一个成员”的创建者房间会永远不监听 node topic，后来的 joiner 也就永远拨不进来。
		if (typeof registry.ensureRuntime === 'function')
			await registry.ensureRuntime()
		registry.registerScopeInterest(scope, [...members])
		registerCleanup(registry.subscribeScope(scope, (senderNodeHash, envelope) => {
			notePeerCandidate(senderNodeHash)
			const entry = actionEntries.get(String(envelope?.action || ''))
			if (entry) 
				if (entry.handler) entry.handler(envelope.payload, senderNodeHash)
				else entry.backlog.push({ payload: envelope.payload, peerId: senderNodeHash })
			
			for (const listener of envelopeListeners)
				listener(senderNodeHash, envelope)
		}))
		registerCleanup(registry.onLinkUp(nodeHash => {
			if (!members.has(nodeHash) || nodeHash === selfNodeHash) return
			notePeerJoin(nodeHash)
		}))
		registerCleanup(registry.onLinkDown(nodeHash => {
			if (!members.has(nodeHash) || nodeHash === selfNodeHash) return
			notePeerLeave(nodeHash)
		}))
		registerCleanup(await subscribeTopic(topic, async bytes => {
			const packet = decryptSignalPacket(topic, bytes)
			if (packet?.type !== 'advert' || !packet.body) return
			const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
			if (!verifiedNodeHash || verifiedNodeHash === selfNodeHash) return
			notePeerCandidate(verifiedNodeHash)
			await registry.ensureLinkToNode(verifiedNodeHash).catch(() => null)
		}))
		registerCleanup(await advertiseTopic(topic, encryptSignalPacket(topic, {
			type: 'advert',
			body: await buildSignedAdvert(topic, Date.now(), registry.localIdentity),
		})))
		if (autoconnect)
			for (const memberNodeHash of members)
				if (memberNodeHash !== selfNodeHash)
					void registry.ensureLinkToNode(memberNodeHash).catch(() => null)
		for (const { peerId } of activeRoster())
			notePeerJoin(peerId)
	}

	return {
		groupId,
		scope,
		start,
		/**
		 * 停止房间并执行所有已注册清理。
		 * @returns {Promise<void>}
		 */
		async leave() {
			if (!active) return
			active = false
			registry.releaseScopeInterest(scope)
			for (const cleanup of cleanups)
				try { cleanup() } catch { /* ignore */ }
			cleanups.clear()
		},
		getRoster: activeRoster,
		/**
		 * 按 nodeHash 查找已连接 peer id。
		 * @param {string} nodeHash 目标节点 64 hex
		 * @returns {string | null} peer id；无链路时 null
		 */
		getPeerIdByNodeHash(nodeHash) {
			return registry.getLink(nodeHash) ? String(nodeHash) : null
		},
		/**
		 * 向单个 peer 发送 scope action。
		 * @param {string} peerId 目标 peer id
		 * @param {string} actionName action 名称
		 * @param {unknown} payload 载荷
		 * @returns {Promise<boolean>} 是否发送成功
		 */
		async sendToPeer(peerId, actionName, payload) {
			return await registry.sendToNodeLink(peerId, { scope, action: String(actionName), payload })
		},
		/**
		 * 向单个或全部在线成员发送 action。
		 * @param {string} actionName action 名称
		 * @param {unknown} payload 载荷
		 * @param {string | null} [peerId] 目标 peer；null 时广播
		 * @returns {Promise<number>} 成功发送的 peer 数
		 */
		async send(actionName, payload, peerId = null) {
			if (peerId) return await this.sendToPeer(peerId, actionName, payload) ? 1 : 0
			let sent = 0
			for (const { peerId: targetPeerId } of activeRoster())
				if (await registry.sendToNodeLink(targetPeerId, { scope, action: String(actionName), payload })) sent++
			return sent
		},
		/**
		 * 订阅入站 envelope。
		 * @param {(senderNodeHash: string, envelope: object) => void} cb 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onEnvelope(cb) {
			envelopeListeners.add(cb)
			return () => envelopeListeners.delete(cb)
		},
		/**
		 * 订阅 peer 加入事件（含当前已在线 peer 的即时回调）。
		 * @param {(peerId: string) => void} cb 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onPeerJoin(cb) {
			peerJoinListeners.add(cb)
			for (const { peerId } of activeRoster())
				if (peerId) announcedPeers.add(peerId)
			for (const peerId of announcedPeers)
				try { cb(peerId) } catch { /* ignore */ }
			return () => peerJoinListeners.delete(cb)
		},
		/**
		 * 订阅 peer 离开事件。
		 * @param {(peerId: string) => void} cb 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onPeerLeave(cb) {
			peerLeaveListeners.add(cb)
			return () => peerLeaveListeners.delete(cb)
		},
		/**
		 * 返回当前在线 peer 的 Record 映射。
		 * @returns {Record<string, true>} peerId → true
		 */
		getPeers() {
			return Object.fromEntries(activeRoster().map(({ peerId }) => [peerId, true]))
		},
		/**
		 * 创建兼容 room.makeAction 的 [send, on] 函数对。
		 * @param {string} name action 名称
		 * @returns {[(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void]} send 与 on 函数对
		 */
		makeAction(name) {
			const actionName = String(name)
			return [
				async (payload, peerId = null) => {
					if (Array.isArray(peerId)) {
						await Promise.all(peerId.map(targetPeerId => this.sendToPeer(targetPeerId, actionName, payload)))
						return
					}
					await this.send(actionName, payload, peerId)
				},
				handler => {
					const entry = getActionEntry(actionName)
					entry.handler = handler
					for (const pending of entry.backlog.splice(0))
						handler(pending.payload, pending.peerId)
				},
			]
		},
		registerCleanup,
		/**
		 * 房间是否仍处于活跃状态。
		 * @returns {boolean} 是否活跃
		 */
		isActive() { return active },
	}
}
