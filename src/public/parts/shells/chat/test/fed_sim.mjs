/**
 * Chat 多节点联邦仿真：单进程、多 fount 用户、无 MQTT relay。
 * 事件以已签名 wire 帧经 appendValidatedRemoteEvent 在节点间传播。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootHeadlessDataRoot } from 'fount/scripts/test/server_harness.mjs'

/**
 * @param {object} [opts] 仿真选项
 * @param {string} [opts.runTag] 运行标签（默认时间戳）
 * @param {string} [opts.dataPath] 数据根（默认临时目录）
 * @param {boolean} [opts.withGovernance] 是否加载 governance_branch / authorize / perms
 * @returns {Promise<object>} 仿真上下文
 */
export async function createChatFedSim(opts = {}) {
	const tag = opts.runTag ?? `fed_${Date.now().toString(36)}`
	const root = opts.dataPath ?? join(tmpdir(), `fount_${tag}`)
	await bootHeadlessDataRoot(root)

	/** @type {Record<string, any>} */
	const M = {
		lifecycle: await import('../src/chat/dag/lifecycle.mjs'),
		materialize: await import('../src/chat/dag/materialize.mjs'),
		remoteIngest: await import('../src/chat/dag/remoteIngest.mjs'),
		append: await import('../src/chat/dag/append.mjs'),
		channelOps: await import('../src/chat/dag/channelOps.mjs'),
		postMessage: await import('../src/chat/channel/postMessage.mjs'),
		schedule: await import('../src/chat/channel_keys/schedule.mjs'),
		queries: await import('../src/chat/dag/queries.mjs'),
		localSigner: await import('../src/chat/dag/localSigner.mjs'),
		replica: await import('../src/chat/lib/replica.mjs'),
		paths: await import('../src/chat/lib/paths.mjs'),
		storage: await import('fount/scripts/p2p/dag/storage.mjs'),
		strip: await import('fount/scripts/p2p/dag/strip_extensions.mjs'),
		state: await import('fount/scripts/p2p/materialized_state.mjs'),
	}

	if (opts.withGovernance !== false) {
		M.authorize = await import('../src/chat/dag/authorizeEvent.mjs')
		M.perms = await import('fount/scripts/p2p/permissions.mjs')
		M.dag = await import('fount/scripts/p2p/governance_branch.mjs')
	}

	/**
	 * @param {string} suffix 节点后缀（如 A/B/C）
	 * @returns {string} fount 用户名
	 */
	const nodeName = suffix => `__${tag}_${suffix}`

	/**
	 * @param {string} node 节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<object[]>} 事件列表
	 */
	async function readEvents(node, groupId) {
		return M.storage.readJsonl(M.paths.eventsPath(node, groupId), {
			sanitize: M.strip.stripDagEventLocalExtensions,
		})
	}

	/**
	 * @param {string} from 源节点
	 * @param {string[]} tos 目标节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<void>}
	 */
	async function federate(from, tos, groupId) {
		for (let round = 0; round < 6; round++) {
			let progressed = false
			const sourceEvents = await readEvents(from, groupId)
			for (const to of tos) {
				if (to === from) continue
				const haveIds = new Set((await readEvents(to, groupId)).map(e => String(e.id).toLowerCase()))
				for (const ev of sourceEvents) {
					if (haveIds.has(String(ev.id).toLowerCase())) continue
					if (await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, ev, { logFailures: false }) === 'ok')
						progressed = true
				}
			}
			if (!progressed) break
		}
	}

	/**
	 * @param {string[]} nodes 节点列表
	 * @param {string} groupId 群 ID
	 * @returns {Promise<void>}
	 */
	async function gossipAll(nodes, groupId) {
		for (let pass = 0; pass < 3; pass++)
			for (const from of nodes)
				await federate(from, nodes, groupId)
	}

	/**
	 * @param {string} from 源节点
	 * @param {string} to 目标节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<void>}
	 */
	async function adoptSnapshot(from, to, groupId) {
		await mkdir(M.paths.groupDir(to, groupId), { recursive: true })
		await copyFile(M.paths.eventsPath(from, groupId), M.paths.eventsPath(to, groupId))
		await copyFile(M.paths.snapshotPath(from, groupId), M.paths.snapshotPath(to, groupId))
	}

	/**
	 * @param {string} node 加入节点
	 * @param {string} ownerNode 源节点
	 * @param {string} groupId 群 ID
	 * @param {string} inviteCode 邀请码
	 * @returns {Promise<string>} 加入者 pubKeyHash
	 */
	async function joinGroup(node, ownerNode, groupId, inviteCode) {
		await adoptSnapshot(ownerNode, node, groupId)
		const { sender, secretKey } = await M.localSigner.getLocalSignerForNewGroup(node, groupId)
		await M.append.appendEvent(node, groupId, {
			type: 'member_join',
			sender,
			timestamp: Date.now(),
			content: { inviteCode, homeNodeHash: M.replica.getLocalNodeHash(node) },
		}, secretKey, { publishFederation: false, skipReleaseQuarantined: true })
		return sender
	}

	/**
	 * @param {string} from 发帖节点
	 * @param {string} groupId 群 ID
	 * @param {string} channelId 频道 ID
	 * @param {string} text 文本
	 * @param {string[]} tos 接收节点
	 * @returns {Promise<object>} 已签名 message 事件
	 */
	async function postMsg(from, groupId, channelId, text, tos) {
		const { event } = await M.postMessage.postChannelMessage(from, groupId, channelId, { text })
		for (const to of tos)
			await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, event, { logFailures: false })
		return event
	}

	/**
	 * @param {string} node 节点
	 * @param {string} groupId 群 ID
	 * @param {string} channelId 频道 ID
	 * @param {string} eventId 消息事件 id
	 * @returns {Promise<object | undefined>} 解密后的消息行
	 */
	async function channelMessage(node, groupId, channelId, eventId) {
		const rows = await M.queries.listChannelMessages(node, groupId, channelId, {
			eventIds: [eventId],
			decrypt: true,
		})
		return rows.find(r => String(r.eventId).toLowerCase() === String(eventId).toLowerCase())
	}

	/**
	 * @param {string} node 节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<object>} 物化状态
	 */
	async function stateOf(node, groupId) {
		return (await M.materialize.getState(node, groupId)).state
	}

	/**
	 * @param {object} state 物化状态
	 * @returns {Set<string>} 活跃成员 pubKeyHash 集合
	 */
	function activeMembers(state) {
		return new Set(Object.entries(state.members)
			.filter(([, m]) => m?.status === 'active')
			.map(([k]) => k))
	}

	/**
	 * @param {string} node 节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<string[]>} 排序后的 DAG tip id
	 */
	async function tipsOf(node, groupId) {
		return [...M.dag.computeDagTipIdsFromEvents(await readEvents(node, groupId))].sort()
	}

	/**
	 * @param {string[]} nodes 节点列表
	 * @param {string} authority 治理节点
	 * @param {string} groupId 群 ID
	 * @returns {Promise<void>}
	 */
	async function converge(nodes, authority, groupId) {
		const others = nodes.filter(n => n !== authority)
		for (const n of others) await federate(n, [authority], groupId)
		await M.lifecycle.convergeDagTipsIfAuthorized(authority, groupId)
		await M.materialize.rebuildAndSaveCheckpoint(authority, groupId)
		for (const n of others) await adoptSnapshot(authority, n, groupId)
	}

	return {
		tag,
		root,
		M,
		groupId: `grp_${tag}`,
		nodeName,
		readEvents,
		federate,
		gossipAll,
		adoptSnapshot,
		joinGroup,
		postMsg,
		channelMessage,
		stateOf,
		activeMembers,
		tipsOf,
		converge,
	}
}
