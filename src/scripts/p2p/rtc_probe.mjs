/**
 * 本机 RTC 直连能力探针：不连对端，只看本机按节点当前 ICE 配置能产出哪些候选、STUN/TURN 是否可用。
 *
 * 只读——不建链、不发信令、不改任何配置，可对活节点随时运行。
 * 用法（在已启动服务器的 checkout 里）：
 *
 *     fount eval -f src/scripts/p2p/rtc_probe.mjs
 *
 * 判定要点：`relay` 计数 > 0 说明 config.json 里配的 TURN 中继可用；`srflx` 计数为 0 说明本机
 * STUN 没有产出服务器反身候选，跨 NAT 打洞时对端无法从公网侧找到本机；出网经代理时 srflx 会变成
 * 代理节点的地址且可能每轮变化，那种地址对端回不来，直连必然不稳定。详见 [signaling.md](docs/signaling.md)。
 */

const PACKAGE_INSTANCE_URL = await import.meta.resolve('npm:@steve02081504/fount-p2p/node/instance')
const POLYFILL_URL = new URL('../link/rtc/polyfill.mjs', PACKAGE_INSTANCE_URL)
const { loadNodeRtcPolyfill } = await import(POLYFILL_URL)
// eval 里相对说明符按 eval runner 解析，所以从包路径反推 checkout 根再取仓内 helper。
const FOUNT_ROOT_URL = `${new URL(PACKAGE_INSTANCE_URL).href.split('/node_modules/')[0]}/`
const { ms } = await import(`${FOUNT_ROOT_URL}src/scripts/ms.mjs`)
const { config: serverConfig } = await import(`${FOUNT_ROOT_URL}src/server/server.mjs`)
const { normalizeNodeIceServers } = await import(`${FOUNT_ROOT_URL}src/server/p2p_server/ice_servers.mjs`)
// 与真实建链同源：config.json 里配了 p2p.iceServers 就用它（含 TURN），没配则回退包的默认 STUN。
const iceServers = normalizeNodeIceServers(serverConfig?.p2p?.iceServers)

/**
 * 报告会进服务器日志，配置里的 TURN 用户名与口令（含 URL 编码形态）不能跟着报错文本流出去。
 * @param {unknown} value 报错文本
 * @returns {string} 抹掉已配置凭据后的文本
 */
function redactIceSecrets(value) {
	let text = String(value || '')
	for (const secret of iceServers.flatMap(server => [server.username, server.credential]).filter(Boolean))
		for (const form of new Set([secret, encodeURIComponent(secret)]))
			text = text.replaceAll(form, '[redacted]')
	return text
}

/** 候选收齐的观察窗口 */
const GATHER_WINDOW_MS = ms('6s')

/**
 * 解析 SDP 候选行。
 * @param {string} line `a=candidate:...` 行
 * @returns {object|null} 解析结果；非候选行返回 null
 */
function parseCandidate(line) {
	const match = /^a=candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)(.*)$/.exec(line.trim())
	if (!match) return null
	return {
		foundation: match[1],
		component: Number(match[2]),
		protocol: match[3],
		priority: Number(match[4]),
		address: match[5],
		port: Number(match[6]),
		type: match[7],
		rest: match[8].trim(),
	}
}

/**
 * 判断地址是不是常见的虚拟网卡/自造地址，这类候选对端不可达。
 * @param {string} address 候选地址
 * @returns {string|null} 命中原因；普通地址返回 null
 */
function virtualReason(address) {
	if (address === '198.18.0.1' || address.startsWith('198.18.')) return 'Clash/代理 TUN 常见地址段'
	if (address.startsWith('192.168.56.')) return 'VirtualBox host-only'
	if (address.startsWith('169.254.')) return 'APIPA（未连接网卡）'
	if (address === 'fdfe:dcba:9876::1') return 'libdatachannel 自造 IPv6'
	return null
}

const rtc = await loadNodeRtcPolyfill({ policy: 'none' })
const candidates = []
const candidateErrors = []
const gatheringStates = []
const report = { now: Date.now(), backend: rtc.backend }

let peerConnection = null
try {
	peerConnection = new rtc.RTCPeerConnection({ iceServers })
	peerConnection.addEventListener?.('icecandidate', event => {
		const line = event?.candidate?.candidate ?? ''
		if (!line) return
		const parsed = parseCandidate(line)
		candidates.push(parsed ? { ...parsed, raw: line.trim(), virtual: virtualReason(parsed.address) } : { raw: line.trim() })
	})
	peerConnection.addEventListener?.('icecandidateerror', event => {
		candidateErrors.push({
			errorCode: event?.errorCode ?? null,
			address: event?.address ?? null,
		})
	})
	peerConnection.addEventListener?.('icegatheringstatechange', () => gatheringStates.push(peerConnection.iceGatheringState))

	// 与真实建链一致：先建数据通道再发 offer，保证 SDP 形状与拨号时相同。
	peerConnection.createDataChannel('probe-control')
	peerConnection.createDataChannel('probe-bulk')
	await peerConnection.setLocalDescription(await peerConnection.createOffer())
	await new Promise(resolve => setTimeout(resolve, GATHER_WINDOW_MS))

	report.iceGatheringState = peerConnection.iceGatheringState
	report.gatheringStates = gatheringStates
	// 只报条数与 scheme（stun / turn / turns）：ICE 服务器地址、用户名与口令都不进报告。
	report.iceServerCount = iceServers.length
	report.iceServerTypes = [...new Set(iceServers.flatMap(server => [server.urls].flat().map(url => url.split(':')[0])))]
	report.candidateErrors = candidateErrors
	report.candidates = candidates

	const counts = {}
	for (const candidate of candidates) counts[candidate.type ?? 'unparsed'] = (counts[candidate.type ?? 'unparsed'] ?? 0) + 1
	report.candidateCounts = counts
	report.virtualCandidates = candidates.filter(candidate => candidate.virtual).map(candidate => `${candidate.address} (${candidate.virtual})`)
	report.srflxPublicAddresses = [...new Set(candidates.filter(candidate => candidate.type === 'srflx').map(candidate => candidate.address))]

	const notes = []
	if (!counts.srflx) notes.push('没有 srflx 候选：本机 STUN 未产出服务器反身候选，跨 NAT 打洞条件不足。')
	if (counts.relay) notes.push('已产出 relay 候选：配置的 TURN 中继可用，可为无法直连的对端提供传输路径。')
	if (report.srflxPublicAddresses.length > 1) notes.push(`srflx 出现多个公网地址（${report.srflxPublicAddresses.join(', ')}）：出网经过会轮换的代理/多出口，NAT 映射不稳定，打洞不可靠。`)
	if (candidateErrors.length) notes.push(`有 ${candidateErrors.length} 条 icecandidateerror，STUN 请求本身在报错（见 candidateErrors）。`)
	if (report.virtualCandidates.length) notes.push(`有 ${report.virtualCandidates.length} 个虚拟网卡候选会被对端尝试但不可达，浪费 ICE 检查预算。`)
	report.notes = notes
	report.verdict = counts.relay
		? '本机已产出 relay 候选：TURN 中继路径可用；若仍连不上，继续检查对端候选与信令。'
		: counts.srflx && report.srflxPublicAddresses.length === 1
			? '本机产出唯一稳定的 srflx，具备跨 NAT 打洞的基本条件；若仍连不上，问题在对端候选或入站策略。'
			: '本机直连条件不足，详见 notes；此时应依赖中继类通道（fount 的 nostr link provider）或为节点配置 TURN。'
}
catch (error) {
	report.error = redactIceSecrets(error?.message || error)
}
finally {
	try { await peerConnection?.close() } catch { /* 已关闭 */ }
}

console.log(JSON.stringify(report, null, 1))
