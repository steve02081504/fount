/**
 * 无头 subfount 客户端：独立进程连主机 scope room，执行 run_code 并回传 response。
 * 同时 startInfra；认证后拉取主机信誉表并优先帮扶主机。
 *
 * 环境变量：
 * - FOUNT_TEST_P2P_RELAY_URL
 * - FOUNT_TEST_SUBFOUNT_HOST_PEER_ID（连接码，非 nodeHash）
 * - FOUNT_TEST_SUBFOUNT_HOST_NODE_HASH（主机 P2P nodeHash，用于预热链路）
 * - FOUNT_TEST_SUBFOUNT_PASSWORD
 * - FOUNT_TEST_SUBFOUNT_NODE_DIR
 * - FOUNT_TEST_SUBFOUNT_INFO_FILE（启动后写入 { nodeHash }）
 * - FOUNT_TEST_SUBFOUNT_READY_FILE（认证成功后写入 "ok"）
 * - FOUNT_TEST_SUBFOUNT_STAGE_FILE（可选进度标记）
 */
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { initTestP2pNode } from 'fount/scripts/test/node/p2p_node.mjs'
import { testSignalingFromRelayUrls } from 'fount/scripts/test/node/p2p_signaling.mjs'
import {
	createGroupLinkSet,
	isInfraRunning,
	lockReputationMax,
	pullReputationFromNode,
	setInfraPriority,
	setReputationTable,
	setTrustSyncDonors,
	startInfra,
	stopInfra,
	unlockReputationMax,
} from 'npm:@steve02081504/fount-p2p'
import { ensureNodeDefaults, getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { ensureLinkToNode, getLink, getLinkRegistry } from 'npm:@steve02081504/fount-p2p/transport/link_registry'

const relayUrl = process.env.FOUNT_TEST_P2P_RELAY_URL?.trim()
const hostPeerId = process.env.FOUNT_TEST_SUBFOUNT_HOST_PEER_ID?.trim()
const hostNodeHashHint = process.env.FOUNT_TEST_SUBFOUNT_HOST_NODE_HASH?.trim().toLowerCase()
const password = process.env.FOUNT_TEST_SUBFOUNT_PASSWORD?.trim()
const nodeDir = process.env.FOUNT_TEST_SUBFOUNT_NODE_DIR?.trim()
const infoFile = process.env.FOUNT_TEST_SUBFOUNT_INFO_FILE?.trim()
const readyFile = process.env.FOUNT_TEST_SUBFOUNT_READY_FILE?.trim()
const stageFile = process.env.FOUNT_TEST_SUBFOUNT_STAGE_FILE?.trim()
const deviceId = 'test-remote-subfount'

/**
 * @param {string} stage 进度标记
 * @returns {Promise<void>}
 */
async function markStage(stage) {
	if (stageFile) await writeFile(stageFile, stage, 'utf8')
}

if (!relayUrl || !hostPeerId || !password || !nodeDir)
	process.exit(2)

initTestP2pNode({ nodeDir, signaling: testSignalingFromRelayUrls(relayUrl) })
ensureNodeDefaults()
await getLinkRegistry().ensureRuntime()
await markStage('init')

const localNodeHash = getNodeHash()
if (infoFile)
	await writeFile(infoFile, JSON.stringify({ nodeHash: localNodeHash }), 'utf8')
await markStage('info')

// 勿 await ensureLinkToNode（可能长时间不 resolve）；轮询链路并旁路拨号。
if (hostNodeHashHint) {
	await markStage('link-warmup')
	for (let attempt = 0; attempt < 90; attempt++) {
		if (getLink(hostNodeHashHint)) break
		void ensureLinkToNode(hostNodeHashHint).catch(() => null)
		await sleep(1000)
	}
}
await markStage('link-ready')

/** @type {any} */
let room = null
let authenticated = false
/** @type {string | null} */
let hostLinkId = null
let infraEnabled = true
/** @type {Record<string, Function>} */
const actions = {}

/**
 * @param {{ infra?: boolean } | null | undefined} data 策略载荷
 * @returns {boolean} 是否启用 infra
 */
function readInfraPolicy(data) {
	return data?.infra !== false
}

/**
 * @param {boolean} enabled 是否跑 infra
 * @returns {Promise<void>}
 */
async function applyInfra(enabled) {
	infraEnabled = Boolean(enabled)
	if (infraEnabled) {
		if (!isInfraRunning()) await startInfra({ logger: null })
		if (authenticated && hostLinkId) await enableHostAssist(hostLinkId)
		return
	}
	if (hostLinkId) {
		setTrustSyncDonors([])
		setInfraPriority({ useLocalReputation: false })
		await unlockReputationMax([hostLinkId]).catch(() => null)
	}
	if (isInfraRunning()) await stopInfra()
}

/**
 * @param {string} nodeHash 主机 nodeHash
 * @returns {Promise<void>}
 */
async function enableHostAssist(nodeHash) {
	if (!infraEnabled) return
	setTrustSyncDonors([nodeHash])
	await lockReputationMax([nodeHash])
	setInfraPriority({ useLocalReputation: true })
	try {
		const table = await Promise.race([
			pullReputationFromNode(nodeHash),
			sleep(10_000).then(() => { throw new Error('reputation pull timed out') }),
		])
		await setReputationTable(table)
	}
	catch { /* host may not have export wire yet in race */ }
}

/**
 * @param {object} message run_code 消息
 * @param {string} peerId 主机 nodeHash
 */
async function handleRunCode(message, peerId) {
	if (peerId !== hostLinkId || !authenticated) return
	const { payload, requestId } = message
	const { script } = payload || {}
	try {
		const { async_eval } = await import('npm:@steve02081504/async-eval')
		const evalResult = await async_eval(script, {})
		await actions.sendResponse({ requestId, payload: evalResult }, hostLinkId)
	}
	catch (error) {
		await actions.sendResponse({
			requestId,
			payload: { error: error.message, stack: error.stack },
			isError: true,
		}, hostLinkId)
	}
}

room = createGroupLinkSet({
	groupId: `subfount:${hostPeerId}`,
	scope: `subfount:${hostPeerId}`,
	roomSecret: password,
	// 测试已 connect-node；已知主机 nodeHash 时直接进 members，避免只靠 discovery。
	members: hostNodeHashHint ? [hostNodeHashHint] : [],
	dialAll: true,
	autoconnect: true,
})
await room.start()
await markStage('room-started')

const [sendAuth, getAuth] = room.makeAction('authenticate')
const [, getRunCode] = room.makeAction('run_code')
const [sendResponse] = room.makeAction('response')
const [, getInfra] = room.makeAction('infra')
actions.sendResponse = sendResponse
actions.sendAuth = sendAuth

getAuth((data, peerId) => {
	if (data?.type === 'authenticated') {
		authenticated = true
		hostLinkId = peerId
		void markStage('authenticated')
		if (readyFile) void writeFile(readyFile, 'ok', 'utf8')
		void applyInfra(readInfraPolicy(data))
	}
	else if (data?.type === 'auth_error' && sendAuth) {
		void markStage('auth-error')
		hostLinkId = peerId
		void sendAuth({ password, deviceId }, peerId)
	}
})

getInfra((data, peerId) => {
	if (!authenticated || peerId !== hostLinkId) return
	void applyInfra(readInfraPolicy(data))
})

getRunCode((message, peerId) => {
	void handleRunCode(message, peerId)
})

room.onPeerJoin((peerId) => {
	void markStage(`peer-join:${peerId}`)
	if (!authenticated && sendAuth && hostLinkId == null) {
		hostLinkId = peerId
		void sendAuth({ password, deviceId }, peerId)
	}
})

process.on('SIGTERM', () => {
	void room?.leave().finally(() => process.exit(0))
})
