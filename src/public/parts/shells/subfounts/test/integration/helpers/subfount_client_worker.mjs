/**
 * 无头 subfount 客户端：独立进程连主机 scope room，执行 run_code 并回传 response。
 *
 * 环境变量：
 * - FOUNT_TEST_P2P_RELAY_URL
 * - FOUNT_TEST_SUBFOUNT_HOST_PEER_ID（连接码，非 nodeHash）
 * - FOUNT_TEST_SUBFOUNT_HOST_NODE_HASH（主机 P2P nodeHash，用于预热链路）
 * - FOUNT_TEST_SUBFOUNT_PASSWORD
 * - FOUNT_TEST_SUBFOUNT_NODE_DIR
 * - FOUNT_TEST_SUBFOUNT_INFO_FILE（启动后写入 { nodeHash }）
 * - FOUNT_TEST_SUBFOUNT_READY_FILE（认证成功后写入 "ok"）
 */
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { ensureNodeDefaults, getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { ensureLinkToNode, getLink, getLinkRegistry } from 'npm:@steve02081504/fount-p2p/transport/link_registry'
import { createScopedLinkRoom } from 'npm:@steve02081504/fount-p2p/rooms/scoped_link'

import { initTestP2pNode } from 'fount/scripts/test/node/p2p_node.mjs'
import { testSignalingFromRelayUrls } from 'fount/scripts/test/node/p2p_signaling.mjs'

const relayUrl = process.env.FOUNT_TEST_P2P_RELAY_URL?.trim()
const hostPeerId = process.env.FOUNT_TEST_SUBFOUNT_HOST_PEER_ID?.trim()
const hostNodeHash = process.env.FOUNT_TEST_SUBFOUNT_HOST_NODE_HASH?.trim().toLowerCase()
const password = process.env.FOUNT_TEST_SUBFOUNT_PASSWORD?.trim()
const nodeDir = process.env.FOUNT_TEST_SUBFOUNT_NODE_DIR?.trim()
const infoFile = process.env.FOUNT_TEST_SUBFOUNT_INFO_FILE?.trim()
const readyFile = process.env.FOUNT_TEST_SUBFOUNT_READY_FILE?.trim()
const deviceId = 'test-remote-subfount'

if (!relayUrl || !hostPeerId || !password || !nodeDir)
	process.exit(2)

initTestP2pNode({ nodeDir, signaling: testSignalingFromRelayUrls(relayUrl) })
ensureNodeDefaults()
await getLinkRegistry().ensureRuntime()

const localNodeHash = getNodeHash()
if (infoFile)
	await writeFile(infoFile, JSON.stringify({ nodeHash: localNodeHash }), 'utf8')

if (hostNodeHash) {
	for (let attempt = 0; attempt < 90; attempt++) {
		await ensureLinkToNode(hostNodeHash).catch(() => null)
		if (getLink(hostNodeHash)) break
		await sleep(1000)
	}
}

/** @type {any} */
let room = null
let authenticated = false
let hostLinkId = null
/** @type {Record<string, Function>} */
const actions = {}

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

room = createScopedLinkRoom({
	scope: `subfount:${hostPeerId}`,
	roomSecret: password,
})
await room.start()

const [sendAuth, getAuth] = room.makeAction('authenticate')
const [, getRunCode] = room.makeAction('run_code')
const [sendResponse] = room.makeAction('response')
actions.sendResponse = sendResponse
actions.sendAuth = sendAuth

getAuth((data, peerId) => {
	if (data?.type === 'authenticated') {
		authenticated = true
		hostLinkId = peerId
		if (readyFile) void writeFile(readyFile, 'ok', 'utf8')
	}
	else if (data?.type === 'auth_error' && sendAuth) {
		hostLinkId = peerId
		void sendAuth({ password, deviceId }, peerId)
	}
})

getRunCode((message, peerId) => {
	void handleRunCode(message, peerId)
})

room.onPeerJoin((peerId) => {
	if (!authenticated && sendAuth && hostLinkId == null) {
		hostLinkId = peerId
		void sendAuth({ password, deviceId }, peerId)
	}
})

process.on('SIGTERM', () => {
	void room?.leave().finally(() => process.exit(0))
})
