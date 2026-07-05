import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

import { createLruMap } from '../memo.mjs'

import { sha256Hex, keyPairFromSeed } from './crypto.mjs'
import { createBluetoothDiscoveryProvider } from './discovery/bt.mjs'
import { advertiseTopic, listenSignals, listDiscoveryProviders, registerDiscoveryProvider, sendSignal, subscribeTopic } from './discovery/index.mjs'
import { createMdnsDiscoveryProvider } from './discovery/mdns.mjs'
import { mergeSignalingRelayUrls, createNostrDiscoveryProvider } from './discovery/nostr.mjs'
import { compareHex64Asc, normalizeHex64 } from './hexIds.mjs'
import { DEFAULT_ICE_SERVERS } from './ice_servers.mjs'
import { buildSignedAdvert, verifySignedAdvert } from './link/handshake.mjs'
import { createLink, shouldCloseOwnInitiated } from './link/link.mjs'
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
	/** @type {Map<string, Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>>} */
	const inflights = new Map()
	/** @type {Map<string, ReturnType<typeof createBufferedSignalSession>>} */
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
	 * 获取或创建到远端节点的信令会话。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @returns {ReturnType<typeof createBufferedSignalSession>} 信令会话
	 */
	function getOrCreateSignalSession(remoteNodeHash) {
		const normalized = normalizeHex64(remoteNodeHash)
		let session = signalSessions.get(normalized)
		if (session) return session
		session = createBufferedSignalSession(async message => {
			await sendSignal(
				nodeRendezvousTopic(normalized),
				normalized,
				encryptSignalPacket(nodeRendezvousTopic(normalized), {
					type: 'signal',
					from: localIdentity.nodeHash,
					body: message,
				}),
			)
		})
		signalSessions.set(normalized, session)
		return session
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
			if (links.get(remoteNodeHash) === link) links.delete(remoteNodeHash)
			for (const listener of linkDownListeners)
				try { listener(remoteNodeHash, reason) } catch { /* ignore */ }
		})
	}

	/**
	 * 注册已建立的链路并处理 glare 冲突。
	 * @param {string} remoteNodeHash 远端节点 64 hex
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} candidate 候选链路
	 * @returns {Promise<void>}
	 */
	async function registerResolvedLink(remoteNodeHash, candidate) {
		const normalized = normalizeHex64(remoteNodeHash)
		const existing = links.get(normalized)
		if (existing && existing !== candidate) 
			if (candidate.initiator && shouldCloseOwnInitiated(localIdentity.nodeHash, normalized))
				await candidate.close('glare-loser')
			else
				await existing.close('replaced-by-new-link')
		
		links.set(normalized, candidate)
		wireLink(normalized, candidate)
		for (const listener of linkUpListeners)
			try { listener(normalized, candidate) } catch { /* ignore */ }
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
		if (!remoteNodeHash || remoteNodeHash === localIdentity.nodeHash) return
		const session = getOrCreateSignalSession(remoteNodeHash)
		if (!links.has(remoteNodeHash) && !inflights.has(remoteNodeHash)) 
			inflights.set(remoteNodeHash, (async () => {
				try {
					const link = await createLinkImpl({
						nodeHash: remoteNodeHash,
						initiator: false,
						signal: session,
						iceServers,
						localIdentity,
					})
					await link.ready
					await registerResolvedLink(remoteNodeHash, link)
					return link
				}
				catch {
					return null
				}
			})().finally(() => inflights.delete(remoteNodeHash)))
		
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
		const session = getOrCreateSignalSession(normalized)
		const task = (async () => {
			try {
				await trimToBudget()
				const link = await createLinkImpl({
					nodeHash: normalized,
					initiator: true,
					signal: session,
					iceServers,
					localIdentity,
				})
				await link.ready
				await registerResolvedLink(normalized, link)
				return link
			}
			catch {
				return null
			}
		})().finally(() => inflights.delete(normalized))
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
