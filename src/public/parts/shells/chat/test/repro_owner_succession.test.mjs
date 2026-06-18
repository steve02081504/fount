/**
 * 复现 fed_misc 的 owner-succession 跨节点收敛失败（单进程、无 MQTT/HTTP）。
 *
 * 镜像 HTTP 流程：B 入群后采纳 A 的签名 checkpoint；A 执行 owner-succession（role_assign +
 * group_settings_update + role_revoke）；B 仅通过「拉取单条签名事件 + 本地 merge-tips」收敛，
 * 不再下发新的签名 checkpoint。最后检查 B 是否看到新 owner。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const RUN_TAG = `os_${Date.now().toString(36)}`
const DATA_PATH = join(tmpdir(), `fount_${RUN_TAG}`)
const NODE_A = `__${RUN_TAG}_A`
const NODE_B = `__${RUN_TAG}_B`
const groupId = `grp_${RUN_TAG}`

/** @type {Record<string, any>} */
let M

/**
 * headless 启动 fount 并加载 DAG 测试模块。
 * @returns {Promise<void>}
 */
async function bootstrap() {
	set_start()
	await init({
		/** @returns {never} 测试态不应触发重启 */
		restartor: () => process.exit(131),
		data_path: DATA_PATH,
		starts: { Base: false, IPC: false, Web: false, Tray: false, DiscordRPC: false },
	})
	M = {
		lifecycle: await import('../src/chat/dag/lifecycle.mjs'),
		materialize: await import('../src/chat/dag/materialize.mjs'),
		remoteIngest: await import('../src/chat/dag/remoteIngest.mjs'),
		append: await import('../src/chat/dag/append.mjs'),
		localSigner: await import('../src/chat/dag/localSigner.mjs'),
		replica: await import('../src/chat/lib/replica.mjs'),
		paths: await import('../src/chat/lib/paths.mjs'),
		storage: await import('../../../../../scripts/p2p/dag/storage.mjs'),
		strip: await import('../../../../../scripts/p2p/dag/strip_extensions.mjs'),
		governance_branch: await import('../../../../../scripts/p2p/governance_branch.mjs'),
	}
}

/**
 * 读取某节点某群的全部已落盘 wire 事件。
 * @param {string} node 节点
 * @returns {Promise<object[]>} 事件列表
 */
async function readEvents(node) {
	return M.storage.readJsonl(M.paths.eventsPath(node, groupId), { sanitize: M.strip.stripDagEventLocalExtensions })
}

/**
 * 复制 join snapshot（events + checkpoint）到目标节点。
 * @param {string} from 源节点
 * @param {string} to 目标节点
 * @returns {Promise<void>}
 */
async function deliverJoinSnapshot(from, to) {
	await mkdir(M.paths.groupDir(to, groupId), { recursive: true })
	await copyFile(M.paths.eventsPath(from, groupId), M.paths.eventsPath(to, groupId))
	await copyFile(M.paths.snapshotPath(from, groupId), M.paths.snapshotPath(to, groupId))
}

/**
 * 单向把 from 多出的事件灌入 to（真实入站校验路径），多轮重试。可选只投递满足 filter 的事件。
 * @param {string} from 源节点
 * @param {string} to 目标节点
 * @param {(ev: object) => boolean} [filter] 可选事件过滤器
 * @returns {Promise<void>}
 */
async function federate(from, to, filter = null) {
	for (let round = 0; round < 6; round++) {
		let progressed = false
		const sourceEvents = await readEvents(from)
		const haveIds = new Set((await readEvents(to)).map(e => String(e.id).toLowerCase()))
		for (const ev of sourceEvents) {
			if (haveIds.has(String(ev.id).toLowerCase())) continue
			if (filter && !filter(ev)) continue
			const res = await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, ev, { logFailures: true })
			if (res === 'ok') progressed = true
			else console.log(`  [federate ${from}->${to}] ${ev.type} => ${res}`)
		}
		if (!progressed) break
	}
}

/**
 * 读取某节点某群的物化 state。
 * @param {string} node 节点
 * @returns {Promise<object>} 物化 state
 */
async function stateOf(node) {
	return (await M.materialize.getState(node, groupId)).state
}

/**
 * 模拟成员入群：复制 snapshot 后追加 member_join。
 * @param {string} node 入群节点
 * @param {string} ownerNode 群主节点
 * @returns {Promise<string>} 新成员的 sender pubKeyHash
 */
async function joinGroup(node, ownerNode) {
	await deliverJoinSnapshot(ownerNode, node)
	const { sender, secretKey } = await M.localSigner.getLocalSignerForNewGroup(node, groupId)
	await M.append.appendEvent(node, groupId, {
		type: 'member_join',
		sender,
		timestamp: Date.now(),
		content: { inviteCode: 'invite-os', homeNodeHash: M.replica.getLocalNodeHash(node) },
	}, secretKey, { publishFederation: false, skipReleaseQuarantined: true })
	return sender
}

/**
 * 本地 merge DAG tips（模拟 catch-up 后的 tip 合并）。
 * @param {string} node 节点
 * @returns {Promise<boolean>} 是否成功合并
 */
async function localMergeTips(node) {
	const { sender, secretKey } = await M.localSigner.resolveLocalEventSigner(node, groupId)
	try {
		await M.lifecycle.mergeDagTips(node, groupId, sender, secretKey)
		return true
	}
	catch (e) {
		console.log(`  [mergeTips ${node}] skip: ${e.message}`)
		return false
	}
}

const hash = {}

/* global Deno */
Deno.test('owner-succession converges on B via event-pull + merge-tips (no fresh checkpoint)', async () => {
	await bootstrap()

	const ownerSigner = await M.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	hash.A = ownerSigner.sender

	await M.lifecycle.createGroup(NODE_A, {
		groupId, name: 'OS Group', ownerPubKeyHash: hash.A,
		secretKey: ownerSigner.secretKey, defaultChannelId: 'default', enableGroupFederation: false,
	})
	await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	hash.B = await joinGroup(NODE_B, NODE_A)
	await federate(NODE_B, NODE_A)
	await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	// B 采纳含自身的最新签名 checkpoint（模拟 join-snapshot）。
	await deliverJoinSnapshot(NODE_A, NODE_B)

	let sB = await stateOf(NODE_B)
	assert(sB.members[hash.B]?.status === 'active', 'B is active after join')
	assert(sB.members[hash.A]?.roles.includes('founder'), 'A is founder before succession')

	// A 在 B 不知情下追加一条事件 X（制造 B 缺失的父链 → 后续 owner-succession 抵达 B 时为「断链组件」）。
	await M.append.appendSignedLocalEvent(NODE_A, groupId, {
		type: 'role_create', timestamp: Date.now(),
		content: {
			roleId: 'gap-role', name: 'Gap', color: '#888', position: 5,
			permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false,
		},
	}, { publishFederation: false })

	// === owner-succession on A ===
	await M.append.appendSignedLocalEvent(NODE_A, groupId, {
		type: 'role_assign', timestamp: Date.now(),
		content: { targetMemberKey: hash.B, roleId: 'founder' },
	}, { publishFederation: false })
	await M.append.appendSignedLocalEvent(NODE_A, groupId, {
		type: 'group_settings_update', timestamp: Date.now(),
		content: { delegatedOwnerPubKeyHash: hash.B },
	}, { publishFederation: false })
	await M.append.appendSignedLocalEvent(NODE_A, groupId, {
		type: 'role_revoke', timestamp: Date.now(),
		content: { targetMemberKey: hash.A, roleId: 'founder' },
	}, { publishFederation: false, skipGenesisSideEffects: true })

	const sA = await stateOf(NODE_A)
	console.log('A delegatedOwner=', sA.delegatedOwnerPubKeyHash, ' B roles=', sA.members[hash.B]?.roles, ' A roles=', sA.members[hash.A]?.roles)

	// === 阶段1：B 仅拉取 owner-succession 相关事件（模拟 fed_misc fallback 的过滤投递）→ 断链组件 ===
	/**
	 * @param {object} ev DAG 事件
	 * @returns {boolean} 是否为 owner-succession 相关事件
	 */
	const ownerSuccessionFilter = ev =>
		(ev.type === 'group_settings_update' && ev.content?.delegatedOwnerPubKeyHash === hash.B) ||
		(ev.type === 'role_assign' && ev.content?.targetMemberKey === hash.B) ||
		ev.type === 'role_revoke'
	await federate(NODE_A, NODE_B, ownerSuccessionFilter)

	sB = await stateOf(NODE_B)
	console.log('[阶段1 断链后] B delegatedOwner=', sB.delegatedOwnerPubKeyHash, ' B founder=', (sB.members[hash.B]?.roles || []).includes('founder'))

	// === 阶段2：模拟 catchUpGroupFromPeers 的祖先回填——投递所有剩余事件（含缺失的 gap 父链）===
	await federate(NODE_A, NODE_B)
	await localMergeTips(NODE_B)
	// 触发隔离区重放（生产路径在每次成功 commit 后调用 releaseQuarantinedEvents）。
	await M.remoteIngest.releaseQuarantinedEvents(NODE_B, groupId)

	sB = await stateOf(NODE_B)
	const bEvents = await readEvents(NODE_B)
	console.log('B events types:', bEvents.map(e => e.type).join(','))
	console.log('B dagTips:', sB.dagTips, ' consensusTip:', sB.consensusBranchTip)
	console.log('B delegatedOwner=', sB.delegatedOwnerPubKeyHash, ' B roles=', sB.members[hash.B]?.roles, ' A roles=', sB.members[hash.A]?.roles)

	const targetIsFounder = (sB.members[hash.B]?.roles || []).includes('founder')
	const otherFounders = Object.entries(sB.members).filter(([k, m]) =>
		m?.status === 'active' && k !== hash.B && (m.roles || []).includes('founder')).length
	const ok = sB.delegatedOwnerPubKeyHash === hash.B || (targetIsFounder && otherFounders === 0)
	assert(ok, `B did not converge to new owner (delegated=${sB.delegatedOwnerPubKeyHash}, targetFounder=${targetIsFounder}, otherFounders=${otherFounders})`)
})
