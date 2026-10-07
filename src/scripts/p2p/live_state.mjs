/**
 * 打印运行中 fount 节点的 P2P 实况：链路、邻居健康、信令 relay 集合与各 peer 路由。
 *
 * 只读——不建链、不改 relay 配置、不发信令，故可以随时对活节点运行。
 * 用法（在已启动服务器的 checkout 里）：
 *
 *     fount eval -f src/scripts/p2p/live_state.mjs
 *
 * 若 `fount eval` 不可用（例如 fount.exe 正在被重编译），用共享客户端直连：
 *
 *     deno run --allow-scripts --allow-all -c deno.json src/scripts/eval.mjs -f src/scripts/p2p/live_state.mjs
 */

const { getNodeHash, getNodeTransportSettings } = await import('npm:@steve02081504/fount-p2p/node/identity')
const { isNodeInitialized, getSignalingRuntimeConfig } = await import('npm:@steve02081504/fount-p2p/node/instance')
const { loadNetwork } = await import('npm:@steve02081504/fount-p2p/node/network')
const { listDiscoveryProviders, listVisibleNodeHashes } = await import('npm:@steve02081504/fount-p2p/discovery/index')
const { resolveNostrRelayUrls } = await import('npm:@steve02081504/fount-p2p/discovery/nostr/index')
const relays = await import('npm:@steve02081504/fount-p2p/discovery/nostr/relays')
const { getLink, getPeerHealth, listLinks, listPeerHealth } = await import('npm:@steve02081504/fount-p2p/transport/link_registry')

/**
 * JSDoc 与函数值友好的浅层序列化：Map/Set/函数/循环引用都不炸。
 * @param {unknown} value 任意值
 * @param {number} [depth] 剩余深度
 * @returns {unknown} 可 JSON 化的值
 */
function plain(value, depth = 6) {
	if (value === null || value === undefined) return value ?? null
	if (typeof value === 'function') return '[fn]'
	if (typeof value !== 'object') return value
	if (depth <= 0) return '[deep]'
	if (Array.isArray(value)) return value.map(item => plain(item, depth - 1))
	if (value instanceof Map) return { __map: [...value.entries()].map(([key, item]) => [String(key), plain(item, depth - 1)]) }
	if (value instanceof Set) return { __set: [...value].map(item => plain(item, depth - 1)) }
	const out = {}
	for (const [key, item] of Object.entries(value)) out[key] = plain(item, depth - 1)
	return out
}

/**
 * 链路摘要（不同 provider 的字段集合不同，缺字段留 null）。
 * @param {object} link 链路实例
 * @returns {object} 摘要
 */
function linkSummary(link) {
	if (!link) return null
	return {
		nodeHash: link.nodeHash ?? link.peerNodeHash ?? null,
		providerId: link.providerId ?? null,
		initiator: link.initiator ?? null,
		stats: typeof link.stats === 'function' ? plain(link.stats()) : null,
	}
}

/**
 * 已连接/已知邻居的 hash 集合：链路 + 健康记录 + 可信邻居（不含 500 条探索池）。
 * @returns {string[]} nodeHash 列表
 */
function knownPeers() {
	const hashes = new Set()
	for (const { nodeHash } of listLinks()) hashes.add(nodeHash)
	for (const { nodeHash } of listPeerHealth()) hashes.add(nodeHash)
	try {
		for (const hash of loadNetwork().trustedPeers ?? []) hashes.add(hash)
	}
	catch { /* 池读取失败不影响链路部分 */ }
	return [...hashes]
}

/**
 * relay 池条目摘要（健康分越低越优，见 computeRelayHealth）。
 * @param {object} entry 池条目
 * @returns {object} 摘要
 */
function relaySummary(entry) {
	return {
		url: entry.url,
		source: entry.source ?? null,
		successCount: entry.successCount ?? 0,
		failureCount: entry.failureCount ?? 0,
		rttMs: entry.rttMs ?? null,
		health: Math.round(relays.computeRelayHealth(entry)),
		lastProbeAgeMs: entry.lastProbe ? Date.now() - entry.lastProbe : null,
	}
}

/** @type {Record<string, unknown>} */
const report = { now: Date.now() }

try { report.nodeHash = getNodeHash() } catch (error) { report.nodeHashError = String(error?.message || error) }
try { report.isNodeInitialized = isNodeInitialized() } catch (error) { report.isNodeInitialized = String(error?.message || error) }
try { report.channels = plain(getSignalingRuntimeConfig?.()?.channels ?? null) } catch (error) { report.channels = String(error?.message || error) }

try { report.links = listLinks().map(({ nodeHash, link }) => ({ peer: nodeHash, ...linkSummary(link) })) }
catch (error) { report.linksError = String(error?.message || error) }

try { report.peerHealth = plain(listPeerHealth()) } catch (error) { report.peerHealthError = String(error?.message || error) }

try {
	report.relays = {
		nodeJsonRelayUrls: getNodeTransportSettings().relayUrls,
		publishSet: resolveNostrRelayUrls(),
		poolPinnedRelays: relays.getPinnedRelays(),
		working: relays.getWorkingRelays().map(relaySummary),
		listen: relays.getListenRelays().map(relaySummary),
	}
}
catch (error) { report.relaysError = String(error?.message || error) }

try { report.discoveryProviders = listDiscoveryProviders().map(provider => provider.id) }
catch (error) { report.discoveryProvidersError = String(error?.message || error) }

try { report.visibleNodeHashes = await listVisibleNodeHashes() }
catch (error) { report.visibleNodeHashesError = String(error?.message || error) }

try {
	report.peerRoutes = Object.fromEntries(knownPeers().map(nodeHash => {
		const route = relays.getPeerRoute(nodeHash)
		return [nodeHash, {
			link: linkSummary(getLink(nodeHash)),
			health: plain(getPeerHealth(nodeHash)),
			listenRelays: route?.listenRelays ?? null,
			lastGoodNostrRelays: route?.lastGoodNostrRelays ?? null,
			peerPoolSize: route?.peerPool?.length ?? null,
			lastSeenAgeMs: route?.lastSeen ? Date.now() - route.lastSeen : null,
		}]
	}))
}
catch (error) { report.peerRoutesError = String(error?.message || error) }

try {
	const network = loadNetwork()
	report.network = {
		trustedPeers: (network.trustedPeers ?? []).length,
		explorePeers: (network.explorePeers ?? []).length,
		hints: (network.hints ?? []).length,
		lastRosterAgeMs: network.lastRosterAt ? Date.now() - network.lastRosterAt : null,
	}
}
catch (error) { report.networkError = String(error?.message || error) }

console.log(JSON.stringify(report, null, 1))
