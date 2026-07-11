import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

import { createLruMap } from './utils/lru.mjs'

import { sha256Hex, keyPairFromSeed } from './crypto.mjs'
import { createBluetoothDiscoveryProvider } from './discovery/bt.mjs'
import { advertiseTopic, listenSignals, listDiscoveryProviders, registerDiscoveryProvider, sendSignal, subscribeTopic } from './discovery/index.mjs'
import { createMdnsDiscoveryProvider } from './discovery/mdns.mjs'
import { mergeSignalingRelayUrls, createNostrDiscoveryProvider } from './discovery/nostr.mjs'
import { compareHex64Asc, normalizeHex64 } from './hexIds.mjs'
import { DEFAULT_ICE_SERVERS } from './ice_servers.mjs'
import { buildSignedAdvert, verifySignedAdvert } from './link/handshake.mjs'
import { createLink } from './link/link.mjs'
import { ensureNodeSeed, getNodeHash, getNodeTransportSettings } from './node/identity.mjs'
import { getSignalingRuntimeConfig } from './node/instance.mjs'
import { createOverlayRouter } from './overlay/index.mjs'

const SIGNAL_DOMAIN = 'fount-signal-v1'
const NODE_TOPIC_DOMAIN = 'fount-rdv-node:'
const GROUP_TOPIC_DOMAIN = 'fount-rdv-group:'

/**
 * 由 nodeHash 派生节点 rendezvous topic。
 * @param {string} nodeHash 节点 64 hex
 * @returns {string} rendezvous topic 哈希
 */
export function nodeRendezvousTopic(nodeHash) {
	return sha256Hex(`${NODE_TOPIC_DOMAIN}${normalizeHex64(nodeHash)}`)
}

/**
 * 由房间密钥派生群组 rendezvous topic。
 * @param {string} roomSecret 房间密钥
 * @returns {string} rendezvous topic 哈希
 */
export function groupRendezvousTopic(roomSecret) {
	return sha256Hex(`${GROUP_TOPIC_DOMAIN}${String(roomSecret || '')}`)
}

/**
 * 由 topic 派生信令 AES 密钥。
 * @param {string} topic rendezvous topic
 * @returns {Buffer} AES-256 密钥
 */
function signalKeyForTopic(topic) {
	return createHash('sha256').update(`${SIGNAL_DOMAIN}:${String(topic)}`).digest()
}

/**
 * 加密信令包为 AES-GCM 字节序列。
 * @param {string} topic rendezvous topic
 * @param {unknown} packet 待加密 JSON 对象
 * @returns {Uint8Array} 加密后的字节
 */
export function encryptSignalPacket(topic, packet) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', signalKeyForTopic(topic), iv)
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(packet), 'utf8')),
		cipher.final(),
	])
	return Buffer.from(JSON.stringify({
		iv: iv.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
		ciphertext: ciphertext.toString('base64'),
	}))
}

/**
 * 解密信令包；失败时返回 null。
 * @param {string} topic rendezvous topic
 * @param {Uint8Array} bytes 加密字节
 * @returns {object | null} 解密后的 JSON 对象
 */
export function decryptSignalPacket(topic, bytes) {
	try {
		const payload = JSON.parse(Buffer.from(bytes).toString('utf8'))
		const decipher = createDecipheriv(
			'aes-256-gcm',
			signalKeyForTopic(topic),
			Buffer.from(payload.iv, 'base64'),
		)
		decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
		const plain = Buffer.concat([
			decipher.update(Buffer.from(payload.ciphertext, 'base64')),
			decipher.final(),
		])
		return JSON.parse(plain.toString('utf8'))
	}
	catch {
		return null
	}
}

/**
 * 解析或从节点种子推导本地身份。
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array } | undefined} localIdentity 可选的预置身份
 * @returns {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }} 规范化后的本地身份
 */
function resolveLocalIdentity(localIdentity) {
	if (localIdentity?.nodeHash && localIdentity?.nodePubKey && localIdentity?.secretKey)
		return {
			nodeHash: normalizeHex64(localIdentity.nodeHash),
			nodePubKey: normalizeHex64(localIdentity.nodePubKey),
			secretKey: localIdentity.secretKey,
		}
	const secretKey = Buffer.from(ensureNodeSeed(), 'hex')
	const { publicKey } = keyPairFromSeed(secretKey)
	return {
		nodeHash: getNodeHash(),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

/**
 * 创建带 backlog 的缓冲信令会话。
 * @param {(message: unknown) => Promise<void>} sendRemote 远端发送回调
 * @returns {{ send: (message: unknown) => Promise<void>, onRemote: (handler: (message: unknown) => void) => () => void, deliver: (message: unknown) => void, clear: () => void }} 信令会话
 */
function createBufferedSignalSession(sendRemote) {
	/** @type {Set<(message: unknown) => void>} */
	const handlers = new Set()
	/** @type {unknown[]} */
	const backlog = []
	return {
		/**
		 * 发送信令消息到远端。
		 * @param {unknown} message 信令消息
		 * @returns {Promise<void>}
		 */
		async send(message) {
			await sendRemote(message)
		},
		/**
		 * 注册远端信令 handler（含 backlog 回放）。
		 * @param {(message: unknown) => void} handler 入站回调
		 * @returns {() => void} 取消订阅函数
		 */
		onRemote(handler) {
			handlers.add(handler)
			for (const pending of backlog.splice(0))
				handler(pending)
			return () => handlers.delete(handler)
		},
		/**
		 * 投递信令消息；无 handler 时入 backlog。
		 * @param {unknown} message 信令消息
		 * @returns {void}
		 */
		deliver(message) {
			if (!handlers.size) {
				backlog.push(message)
				return
			}
			for (const handler of handlers)
				handler(message)
		},
		/**
		 * 清空 backlog 与 handler。
		 * @returns {void}
		 */
		clear() {
			backlog.length = 0
			handlers.clear()
		},
	}
}

/**
 * 向 Map<key, Set<listener>> 订阅并返回取消函数。
 * @param {Map<string, Set<Function>>} buckets 监听器桶
 * @param {string} key 桶键
 * @param {Function} listener 监听器
 * @returns {() => void} 取消订阅函数
 */
function subscribeBucket(buckets, key, listener) {
	if (!buckets.has(key)) buckets.set(key, new Set())
	buckets.get(key).add(listener)
	return () => {
		const set = buckets.get(key)
		if (!set) return
		set.delete(listener)
		if (!set.size) buckets.delete(key)
	}
}

/**
 * 创建 P2P 链路注册表（discovery、信令、直连与 overlay relay）。
 * @param {object} [opts] 选项
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array }} [opts.localIdentity] 本地身份
 * @param {typeof createLink} [opts.createLink] 链路工厂（可注入 mock）
 * @param {RTCConfiguration['iceServers']} [opts.iceServers] ICE 服务器列表
 * @param {number} [opts.maxActive] 最大并发活跃链路数
 * @param {boolean} [opts.autoRegisterDiscoveryProviders] 是否自动注册 discovery provider
 * @returns {object} link registry 接口
 */
export function createLinkRegistry(opts = {}) {
	const localIdentity = resolveLocalIdentity(opts.localIdentity)
	const createLinkImpl = opts.createLink ?? createLink
	const iceServers = opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE_SERVERS
	const maxActive = Math.max(4, Number(opts.maxActive) || 32)
	const autoRegisterDiscoveryProviders = opts.autoRegisterDiscoveryProviders !== false
	const selfTopic = nodeRendezvousTopic(localIdentity.nodeHash)
	/** @type {Map<string, Awaited<ReturnType<typeof createLinkImpl>>>} */
	const links = new Map()
	/** @type {Map<string, Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>>} 按 nodeHash 去重的主动外拨 */
	const inflights = new Map()
	/** @type {Map<string, ReturnType<typeof createBufferedSignalSession>>} 按 connId 索引的信令会话（每条 PC 一个方向） */
	const signalSessions = new Map()
	/** @type {Map<string, Set<string>>} */
	const scopeInterests = new Map()
	/** @type {Map<string, Set<Function>>} */
	const scopeListeners = new Map()
	/** @type {Map<string, Function>} */
	const scopeAuthorizers = new Map()
	/** @type {Set<(nodeHash: string, link: unknown) => void>} */
	const linkUpListeners = new Set()
	/** @type {Set<(nodeHash: string, reason: string) => void>} */
	const linkDownListeners = new Set()
	const recentAdverts = createLruMap(1024)
	let runtimeStarted = false
	let stopAdvert = null
	let stopSignalListener = null
	let overlayRouter = null

	/**
	 * 启动 discovery runtime（advert + signal listener）。
	 * @returns {Promise<void>}
	 */
	async function ensureDiscoveryRuntime() {
		if (runtimeStarted) return
		runtimeStarted = true
		if (autoRegisterDiscoveryProviders) {
			const providerIds = new Set(listDiscoveryProviders().map(provider => provider.id))
			if (!providerIds.has('mdns'))
				registerDiscoveryProvider(createMdnsDiscoveryProvider())
			if (!providerIds.has('bt') && process.env.FOUNT_ENABLE_BT_DISCOVERY === '1')
				registerDiscoveryProvider(createBluetoothDiscoveryProvider())
			if (!providerIds.has('nostr'))
				// 测试通过 initNode({ signaling: { relayOverride } }) 注入共享 loopback relay；生产则回落到用户 relay + 默认公网 relay。
				// 新 discovery 栈也必须尊重这层 runtime override，否则 live 双节点测试会各打各的公网 relay。
				registerDiscoveryProvider(createNostrDiscoveryProvider({
					relayUrls: getSignalingRuntimeConfig().relayOverride
						?? mergeSignalingRelayUrls(getNodeTransportSettings().relayUrls),
				}))
		}
		if (!listDiscoveryProviders().length) return
		stopSignalListener = await listenSignals(selfTopic, bytes => {
			void handleIncomingSignal(bytes).catch(() => {})
		})
		stopAdvert = await advertiseTopic(selfTopic, encryptSignalPacket(selfTopic, {
			type: 'advert',
			body: await buildSignedAdvert(selfTopic, Date.now(), localIdentity),
		}))
	}

	/**
	 * 为单条 PC 创建按 connId 标记的信令会话。出站信令都带上 connId，
	 * 使同一对节点的两个方向（各自一条 PC）在信令层互不串扰。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {string} connId 连接标识
	 * @returns {ReturnType<typeof createBufferedSignalSession>} 信令会话
	 */
	function createConnSession(remoteNodeHash, connId) {
		const normalized = normalizeHex64(remoteNodeHash)
		const topic = nodeRendezvousTopic(normalized)
		return createBufferedSignalSession(async message => {
			await sendSignal(topic, normalized, encryptSignalPacket(topic, {
				type: 'signal',
				from: localIdentity.nodeHash,
				connId,
				body: message,
			}))
		})
	}

	/**
	 * 判断信令 body 是否为发起方 offer（据此决定入站是否新建应答 PC）。
	 * @param {unknown} body 信令 body
	 * @returns {boolean} 是 offer 则 true
	 */
	function isOfferSignalBody(body) {
		return !!body && typeof body === 'object'
			&& body.type === 'description'
			&& body.description?.type === 'offer'
	}

	/**
	 * 保留由较小 nodeHash 发起的那条链（两端对任意一条链算出一致结论），用于双 PC glare 择一。
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} link 链路实例
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @returns {boolean} 本条链应保留则 true
	 */
	function linkIsPreferred(link, remoteNodeHash) {
		const cmp = compareHex64Asc(localIdentity.nodeHash, remoteNodeHash)
		return link.initiator ? cmp < 0 : cmp > 0
	}

	/**
	 * 为链路绑定 envelope 派发与 down 回调。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} link 链路实例
	 * @returns {void}
	 */
	function wireLink(remoteNodeHash, link) {
		link.onEnvelope((envelope, senderNodeHash) => {
			void dispatchEnvelope(senderNodeHash, envelope, link).catch(() => {})
		})
		link.onDown(reason => {
			// 只有关闭的是当前规范链路才对外报 linkDown；双 PC 并存期关掉的败者不应误发 peer-leave。
			const wasCanonical = links.get(remoteNodeHash) === link
			if (!wasCanonical) return
			links.delete(remoteNodeHash)
			for (const listener of linkDownListeners)
				try { listener(remoteNodeHash, reason) } catch { /* ignore */ }
		})
	}

	/**
	 * 注册已建立的链路，并做双 PC glare 择一：同一对节点若因双向同时发起而建成两条 PC，
	 * 保留由较小 nodeHash 发起的那条（两端一致），关闭另一条。单条链路（常态）直接安装。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} candidate 候选链路
	 * @returns {Promise<void>}
	 */
	async function registerResolvedLink(remoteNodeHash, candidate) {
		const normalized = normalizeHex64(remoteNodeHash)
		const existing = links.get(normalized)
		// 已有规范链且候选不优先：候选出局，保留现有。
		if (existing && existing !== candidate && !linkIsPreferred(candidate, normalized)) {
			await candidate.close('glare-loser')
			return
		}
		// 候选胜出（或无现有）：先把 candidate 设为规范链，再关旧链——
		// 这样旧链 onDown 时 links.get 已指向 candidate，不会被误判为规范链而对外报 linkDown。
		links.set(normalized, candidate)
		wireLink(normalized, candidate)
		if (existing && existing !== candidate)
			await existing.close('glare-replaced')
		for (const listener of linkUpListeners)
			try { listener(normalized, candidate) } catch { /* ignore */ }
	}

	/**
	 * 为一条 connId 会话建 PC 并走 glare 择一：建 link → 绑 onDown 清 session → ready → registerResolvedLink。
	 * initiator 侧建链前先 trimToBudget 腾预算。出错则清理该 connId 会话。
	 * @param {{ remoteNodeHash: string, connId: string, session: ReturnType<typeof createBufferedSignalSession>, initiator: boolean }} opts 建链参数
	 * @returns {Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>} 当前规范链（本条可能因 glare 被关，取 links 现值）；失败 null
	 */
	async function buildConnLink({ remoteNodeHash, connId, session, initiator }) {
		try {
			if (initiator) await trimToBudget()
			const link = await createLinkImpl({ nodeHash: remoteNodeHash, initiator, signal: session, iceServers, localIdentity })
			link.onDown(() => signalSessions.delete(connId))
			await link.ready
			await registerResolvedLink(remoteNodeHash, link)
			return links.get(remoteNodeHash) ?? null
		}
		catch {
			signalSessions.delete(connId)
			return null
		}
	}

	/**
	 * 处理入站加密信令并可能发起被动建链。
	 * @param {Uint8Array} bytes 加密信令字节
	 * @returns {Promise<void>}
	 */
	async function handleIncomingSignal(bytes) {
		const packet = decryptSignalPacket(selfTopic, bytes)
		if (!packet || packet.type !== 'signal') return
		const remoteNodeHash = normalizeHex64(packet.from)
		const connId = String(packet.connId || '')
		if (!remoteNodeHash || remoteNodeHash === localIdentity.nodeHash || !connId) return
		let session = signalSessions.get(connId)
		if (!session) {
			// 只有全新的 offer 才开一条独立应答 PC；answer/ice 若无对应 connId 会话则是迟到/无效帧，丢弃。
			// 应答 PC 按 connId 独立创建，不受按 nodeHash 去重的 inflight 阻挡——这是支持双向同时建链的关键。
			if (!isOfferSignalBody(packet.body)) return
			session = createConnSession(remoteNodeHash, connId)
			signalSessions.set(connId, session)
			void buildConnLink({ remoteNodeHash, connId, session, initiator: false })
		}
		session.deliver(packet.body)
	}

	/**
	 * 计算节点在 scope 兴趣中的权重（用于 eviction）。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @returns {number} 权重值
	 */
	function scopeWeight(remoteNodeHash) {
		let weight = 0
		for (const hashes of scopeInterests.values())
			if (hashes.has(remoteNodeHash)) weight++
		return weight
	}

	/**
	 * 超出 maxActive 时驱逐权重最低的链路。
	 * @returns {Promise<void>}
	 */
	async function trimToBudget() {
		if (links.size < maxActive) return
		const candidates = [...links.entries()]
			.sort((left, right) => scopeWeight(left[0]) - scopeWeight(right[0]) || compareHex64Asc(left[0], right[0]))
		const victim = candidates[0]
		if (victim) await victim[1].close('budget-evict')
	}

	/**
	 * 主动建链到远端节点（initiator）。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @returns {Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>} 链路实例；失败时 null
	 */
	async function ensureDirectLinkToNode(remoteNodeHash) {
		await ensureDiscoveryRuntime()
		const normalized = normalizeHex64(remoteNodeHash)
		if (!normalized || normalized === localIdentity.nodeHash) return null
		if (links.has(normalized)) return links.get(normalized)
		if (inflights.has(normalized)) return await inflights.get(normalized)
		// 想连就直拨（单向零额外成本）；若对端也在同时拨，双方各建一条 PC，由 registerResolvedLink 择一。
		// buildConnLink 成功时返回的是规范链而非本条 candidate——glare 双 PC 择一时本条可能是被关闭的败者。
		const connId = randomBytes(16).toString('hex')
		const session = createConnSession(normalized, connId)
		signalSessions.set(connId, session)
		const task = buildConnLink({ remoteNodeHash: normalized, connId, session, initiator: true })
			.finally(() => inflights.delete(normalized))
		inflights.set(normalized, task)
		return await task
	}

	/**
	 * 经已有直连发送 envelope。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {{ scope: string, action: string, payload: unknown }} envelope 信封
	 * @returns {Promise<boolean>} 是否发送成功
	 */
	async function sendDirectToNodeLink(remoteNodeHash, envelope) {
		const normalized = normalizeHex64(remoteNodeHash)
		if (!normalized) return false
		const link = links.get(normalized)
		if (!link) return false
		try {
			return await link.send(envelope)
		}
		catch {
			return false
		}
	}

	/**
	 * 懒创建 overlay 路由器。
	 * @returns {ReturnType<typeof createOverlayRouter>} overlay 路由器
	 */
	function getOverlayRouter() {
		if (overlayRouter) return overlayRouter
		overlayRouter = createOverlayRouter({
			localIdentity,
			sendToNodeLink: sendDirectToNodeLink,
			/**
			 * 列出当前所有活跃链路。
			 * @returns {Array<{ nodeHash: string, link: Awaited<ReturnType<typeof createLinkImpl>> }>} 链路列表
			 */
			listLinks() {
				return [...links.entries()].map(([nodeHash, link]) => ({ nodeHash, link }))
			},
			subscribeScope,
		})
		overlayRouter.onRelay((body, meta) => {
			void dispatchEnvelope(meta.path[0], body, null).catch(() => {})
		})
		return overlayRouter
	}

	/**
	 * 经 overlay 多跳 relay envelope 到无直连的节点。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {{ scope: string, action: string, payload: unknown }} envelope 信封
	 * @returns {Promise<boolean>} 是否 relay 成功
	 */
	async function relayEnvelopeToNode(remoteNodeHash, envelope) {
		if (!links.size || envelope?.scope === 'overlay') return false
		try {
			const path = await getOverlayRouter().discoverRoute(remoteNodeHash)
			await getOverlayRouter().relay(path, envelope)
			return true
		}
		catch {
			return false
		}
	}

	/**
	 * 确保到远端节点的链路（直连或被动应答）。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @returns {Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>} 链路实例
	 */
	async function ensureLinkToNode(remoteNodeHash) {
		return await ensureDirectLinkToNode(remoteNodeHash)
	}

	/**
	 * 发送 envelope：优先直连，失败则 overlay relay。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {{ scope: string, action: string, payload: unknown }} envelope 信封
	 * @returns {Promise<boolean>} 是否发送成功
	 */
	async function sendToNodeLink(remoteNodeHash, envelope) {
		return await sendDirectToNodeLink(remoteNodeHash, envelope)
			|| await relayEnvelopeToNode(remoteNodeHash, envelope)
	}

	/**
	 * 将入站 envelope 派发到 scope 监听器（经 authorizer 校验）。
	 * @param {string} senderNodeHash 发送方节点 64 hex
	 * @param {{ scope: string, action: string, payload: unknown }} envelope 信封
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} link 来源链路
	 * @returns {Promise<void>}
	 */
	async function dispatchEnvelope(senderNodeHash, envelope, link) {
		const scope = String(envelope?.scope || '')
		for (const [prefix, authorizer] of scopeAuthorizers.entries())
			if (scope.startsWith(prefix)) {
				const allowed = await Promise.resolve(authorizer(scope, senderNodeHash, envelope, link))
				if (!allowed) return
			}
		for (const [prefix, listeners] of scopeListeners.entries())
			if (scope.startsWith(prefix))
				for (const listener of listeners)
					await Promise.resolve(listener(senderNodeHash, envelope, link))
	}

	/**
	 * 订阅指定 scope 前缀的 envelope。
	 * @param {string} prefix scope 前缀
	 * @param {(senderNodeHash: string, envelope: { scope: string, action: string, payload: unknown }, link: Awaited<ReturnType<typeof createLinkImpl>>) => void | Promise<void>} listener 监听器
	 * @returns {() => void} 取消订阅函数
	 */
	function subscribeScope(prefix, listener) {
		return subscribeBucket(scopeListeners, String(prefix), listener)
	}

	/**
	 * 注册 scope 前缀的 authorizer（入站校验）。
	 * @param {string} prefix scope 前缀
	 * @param {(scope: string, senderNodeHash: string, envelope: object, link: Awaited<ReturnType<typeof createLinkImpl>>) => boolean | Promise<boolean>} authorizer 校验函数
	 * @returns {() => void} 取消注册函数
	 */
	function registerScopeAuthorizer(prefix, authorizer) {
		scopeAuthorizers.set(String(prefix), authorizer)
		return () => scopeAuthorizers.delete(String(prefix))
	}

	return {
		localIdentity,
		ensureRuntime: ensureDiscoveryRuntime,
		ensureLinkToNode,
		/**
		 * 获取到指定节点的活跃链路。
		 * @param {string} nodeHash 节点 64 hex
		 * @returns {Awaited<ReturnType<typeof createLinkImpl>> | null} 链路实例；不存在时 null
		 */
		getLink(nodeHash) {
			return links.get(normalizeHex64(nodeHash)) || null
		},
		/**
		 * 列出所有活跃链路。
		 * @returns {Array<{ nodeHash: string, link: Awaited<ReturnType<typeof createLinkImpl>> }>} 链路列表
		 */
		listLinks() {
			return [...links.entries()].map(([nodeHash, link]) => ({ nodeHash, link }))
		},
		/**
		 * 关闭到指定节点的链路。
		 * @param {string} nodeHash 节点 64 hex
		 * @param {string} [reason='manual-close'] 关闭原因
		 * @returns {Promise<void>}
		 */
		async closeLink(nodeHash, reason = 'manual-close') {
			const normalized = normalizeHex64(nodeHash)
			const link = links.get(normalized)
			if (!link) return
			await link.close(reason)
		},
		sendToNodeLink,
		/**
		 * 订阅链路建立事件。
		 * @param {(nodeHash: string, link: unknown) => void} listener 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onLinkUp(listener) {
			linkUpListeners.add(listener)
			return () => linkUpListeners.delete(listener)
		},
		/**
		 * 订阅链路断开事件。
		 * @param {(nodeHash: string, reason: string) => void} listener 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onLinkDown(listener) {
			linkDownListeners.add(listener)
			return () => linkDownListeners.delete(listener)
		},
		/**
		 * 注册 scope 兴趣成员（影响 eviction 权重）。
		 * @param {string} scope scope 名称
		 * @param {string[]} nodeHashes 成员 nodeHash 列表
		 * @returns {void}
		 */
		registerScopeInterest(scope, nodeHashes) {
			scopeInterests.set(String(scope), new Set((Array.isArray(nodeHashes) ? nodeHashes : []).map(normalizeHex64).filter(Boolean)))
		},
		/**
		 * 释放 scope 兴趣。
		 * @param {string} scope scope 名称
		 * @returns {void}
		 */
		releaseScopeInterest(scope) {
			scopeInterests.delete(String(scope))
		},
		registerScopeAuthorizer,
		subscribeScope,
		/**
		 * 订阅指定节点的 advert 广播。
		 * @param {string} nodeHash 目标节点 64 hex
		 * @param {(verifiedNodeHash: string, body: object) => void | Promise<void>} onAdvert advert 回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
		async subscribeNodeAdvert(nodeHash, onAdvert) {
			const topic = nodeRendezvousTopic(nodeHash)
			return await subscribeTopic(topic, async bytes => {
				const packet = decryptSignalPacket(topic, bytes)
				if (packet?.type !== 'advert') return
				const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
				if (!verifiedNodeHash) return
				recentAdverts.touch(verifiedNodeHash, Date.now())
				await Promise.resolve(onAdvert(verifiedNodeHash, packet.body))
			})
		},
		recentAdverts,
		relayEnvelopeToNode,
		/**
		 * 关闭 registry：停止 discovery、overlay 并断开所有链路。
		 * @returns {Promise<void>}
		 */
		async shutdown() {
			stopAdvert?.()
			stopSignalListener?.()
			overlayRouter?.close()
			overlayRouter = null
			for (const link of links.values())
				await link.close('registry-shutdown')
			links.clear()
			inflights.clear()
			for (const session of signalSessions.values()) session.clear()
			signalSessions.clear()
		},
	}
}

let defaultRegistry = null

/**
 * 获取进程级默认 link registry 单例。
 * @returns {ReturnType<typeof createLinkRegistry>} 默认 registry
 */
export function getLinkRegistry() {
	if (!defaultRegistry) defaultRegistry = createLinkRegistry()
	return defaultRegistry
}

/**
 * 默认 registry 的 ensureLinkToNode 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['ensureLinkToNode']>} 链路实例
 */
export const ensureLinkToNode = (...args) => getLinkRegistry().ensureLinkToNode(...args)
/**
 * 默认 registry 的 getLink 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['getLink']>} 链路实例
 */
export const getLink = (...args) => getLinkRegistry().getLink(...args)
/**
 * 默认 registry 的 listLinks 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['listLinks']>} 链路列表
 */
export const listLinks = (...args) => getLinkRegistry().listLinks(...args)
/**
 * 默认 registry 的 closeLink 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['closeLink']>} 关闭完成
 */
export const closeLink = (...args) => getLinkRegistry().closeLink(...args)
/**
 * 默认 registry 的 sendToNodeLink 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['sendToNodeLink']>} 是否成功
 */
export const sendToNodeLink = (...args) => getLinkRegistry().sendToNodeLink(...args)
/**
 * 默认 registry 的 relayEnvelopeToNode 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['relayEnvelopeToNode']>} 是否成功
 */
export const relayEnvelopeToNode = (...args) => getLinkRegistry().relayEnvelopeToNode(...args)
/**
 * 默认 registry 的 onLinkUp 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['onLinkUp']>} 取消订阅函数
 */
export const onLinkUp = (...args) => getLinkRegistry().onLinkUp(...args)
/**
 * 默认 registry 的 onLinkDown 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['onLinkDown']>} 取消订阅函数
 */
export const onLinkDown = (...args) => getLinkRegistry().onLinkDown(...args)
/**
 * 默认 registry 的 registerScopeInterest 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['registerScopeInterest']>} 无返回值
 */
export const registerScopeInterest = (...args) => getLinkRegistry().registerScopeInterest(...args)
/**
 * 默认 registry 的 releaseScopeInterest 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['releaseScopeInterest']>} 无返回值
 */
export const releaseScopeInterest = (...args) => getLinkRegistry().releaseScopeInterest(...args)
/**
 * 默认 registry 的 registerScopeAuthorizer 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['registerScopeAuthorizer']>} 取消注册函数
 */
export const registerScopeAuthorizer = (...args) => getLinkRegistry().registerScopeAuthorizer(...args)
/**
 * 默认 registry 的 subscribeScope 代理。
 * @param {...any} args 转发参数
 * @returns {ReturnType<ReturnType<typeof createLinkRegistry>['subscribeScope']>} 取消订阅函数
 */
export const subscribeScope = (...args) => getLinkRegistry().subscribeScope(...args)
