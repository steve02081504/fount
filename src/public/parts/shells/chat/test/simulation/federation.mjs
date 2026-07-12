/**
 * Chat 多节点联邦仿真：单进程、多 fount 用户、无 Nostr relay。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'

/**
 * 初始化 headless 联邦仿真上下文。
 * @param {object} [options] 仿真选项
 * @param {string} [options.runTag] 运行标签
 * @param {string} [options.dataPath] 数据根目录
 * @param {boolean} [options.withGovernance] 是否加载治理模块
 * @returns {Promise<object>} 仿真上下文
 */
export async function createChatFederationSim(options = {}) {
	const runTag = options.runTag ?? `fed_${Date.now().toString(36)}`
	const dataRoot = options.dataPath ?? join(tmpdir(), `fount_${runTag}`)
	await bootHeadlessDataRoot(dataRoot)
	await import('../../src/chat/dag/index.mjs')

	const modules = {
		lifecycle: await import('../../src/chat/dag/lifecycle.mjs'),
		materialize: await import('../../src/chat/dag/materialize.mjs'),
		remoteIngest: await import('../../src/chat/dag/remoteIngest.mjs'),
		append: await import('../../src/chat/dag/append.mjs'),
		channelOps: await import('../../src/chat/dag/channelOps.mjs'),
		channelMessaging: await import('../../src/chat/channel/postMessage.mjs'),
		schedule: await import('../../src/chat/channel_keys/schedule.mjs'),
		queries: await import('../../src/chat/dag/queries.mjs'),
		localSigner: await import('../../src/chat/dag/localSigner.mjs'),
		replica: await import('../../src/chat/lib/replica.mjs'),
		paths: await import('../../src/chat/lib/paths.mjs'),
		storage: await import('npm:@steve02081504/fount-p2p/dag/storage'),
		strip: await import('npm:@steve02081504/fount-p2p/dag/strip_extensions'),
		state: await import('../../src/chat/dag/groupMaterializedState.mjs'),
	}

	if (options.withGovernance !== false) {
		modules.authorize = await import('../../src/chat/dag/authorizeEvent.mjs')
		modules.perms = await import('fount/public/parts/shells/chat/src/permissions/chat.mjs')
		modules.dag = await import('npm:@steve02081504/fount-p2p/governance/branch')
	}

	/**
	 * 生成仿真节点用户名。
	 * @param {string} suffix 节点后缀
	 * @returns {string} 仿真节点用户名
	 */
	const nodeName = suffix => `__${runTag}_${suffix}`

	/**
	 * 读取节点群组 DAG 事件列表。
	 * @param {string} node 节点用户名
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<object[]>} DAG 事件列表
	 */
	async function readEvents(node, groupId) {
		return modules.storage.readJsonl(modules.paths.eventsPath(node, groupId), {
			sanitize: modules.strip.stripDagEventLocalExtensions,
		})
	}

	/**
	 * @param {string} node 节点用户名
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<Set<string>>} 事件 id 集合（小写）
	 */
	async function eventIdsOf(node, groupId) {
		return new Set((await readEvents(node, groupId)).map(event => String(event.id).trim().toLowerCase()))
	}

	/**
	 * 断言多节点持有相同事件 id 集合（联邦仿真收敛检查）。
	 * @param {string[]} nodes 节点列表
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<void>}
	 */
	async function assertPeersConverged(nodes, groupId) {
		if (nodes.length < 2) return
		const baseline = await eventIdsOf(nodes[0], groupId)
		for (const node of nodes.slice(1)) {
			const ids = await eventIdsOf(node, groupId)
			if (ids.size !== baseline.size || [...baseline].some(id => !ids.has(id)))
				throw new Error(`federation sim divergence: ${nodes[0]} has ${baseline.size} events, ${node} has ${ids.size}`)
		}
	}

	/**
	 * 将源节点事件联邦同步到目标节点。
	 * @param {string} sourceNode 源节点
	 * @param {string[]} targetNodes 目标节点列表
	 * @param {string} groupId 群组 ID
	 * @param {{ logFailures?: boolean }} [opts] 选项
	 * @returns {Promise<{ applied: number, failed: number }>} 同步统计
	 */
	async function federate(sourceNode, targetNodes, groupId, opts = {}) {
		const logFailures = opts.logFailures !== false
		let applied = 0
		let failed = 0
		for (let round = 0; round < 6; round++) {
			let progressed = false
			const sourceEvents = await readEvents(sourceNode, groupId)
			for (const targetNode of targetNodes) {
				if (targetNode === sourceNode) continue
				const knownIds = new Set((await readEvents(targetNode, groupId)).map(event => String(event.id).toLowerCase()))
				for (const event of sourceEvents) {
					if (knownIds.has(String(event.id).toLowerCase())) continue
					const status = await modules.remoteIngest.appendValidatedRemoteEvent(targetNode, groupId, event, { logFailures })
					if (status.status === 'applied') {
						progressed = true
						applied++
					}
					else if (status.status !== 'duplicate') failed++
				}
			}
			if (!progressed) break
		}
		return { applied, failed }
	}

	/**
	 * 多轮全网 gossip 同步，可选收敛断言。
	 * @param {string[]} nodes 节点列表
	 * @param {string} groupId 群组 ID
	 * @param {{ assertConverged?: boolean }} [opts] 选项
	 * @returns {Promise<void>}
	 */
	async function gossipAll(nodes, groupId, opts = {}) {
		for (let pass = 0; pass < 3; pass++)
			for (const sourceNode of nodes)
				await federate(sourceNode, nodes, groupId)
		if (opts.assertConverged)
			await assertPeersConverged(nodes, groupId)
	}

	/**
	 * 复制快照与事件日志到目标节点。
	 * @param {string} sourceNode 快照源节点
	 * @param {string} targetNode 快照目标节点
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<void>}
	 */
	async function adoptSnapshot(sourceNode, targetNode, groupId) {
		await mkdir(modules.paths.groupDir(targetNode, groupId), { recursive: true })
		await copyFile(modules.paths.eventsPath(sourceNode, groupId), modules.paths.eventsPath(targetNode, groupId))
		await copyFile(modules.paths.snapshotPath(sourceNode, groupId), modules.paths.snapshotPath(targetNode, groupId))
	}

	/**
	 * 模拟成员通过邀请码加入群组。
	 * @param {string} joinerNode 加入者节点
	 * @param {string} ownerNode 群主节点
	 * @param {string} groupId 群组 ID
	 * @param {string} inviteCode 邀请码
	 * @returns {Promise<string>} 加入者 sender 公钥哈希
	 */
	async function joinGroup(joinerNode, ownerNode, groupId, inviteCode) {
		await adoptSnapshot(ownerNode, joinerNode, groupId)
		const { sender, secretKey } = await modules.localSigner.getLocalSignerForNewGroup(joinerNode, groupId)
		await modules.append.appendEvent(joinerNode, groupId, {
			type: 'member_join',
			sender,
			timestamp: Date.now(),
			content: { inviteCode, homeNodeHash: modules.replica.getLocalNodeHash(joinerNode) },
		}, secretKey, { publishFederation: false, skipReleaseQuarantined: true })
		return sender
	}

	/**
	 * 发送频道消息并联邦到目标节点。
	 * @param {string} sourceNode 发送节点
	 * @param {string} groupId 群组 ID
	 * @param {string} channelId 频道 ID
	 * @param {string} text 消息文本
	 * @param {string[]} targetNodes 联邦同步目标节点
	 * @returns {Promise<object>} 已发送事件
	 */
	async function postMessage(sourceNode, groupId, channelId, text, targetNodes) {
		const { event } = await modules.channelMessaging.postChannelMessage(sourceNode, groupId, channelId, { text })
		for (const targetNode of targetNodes)
			await modules.remoteIngest.appendValidatedRemoteEvent(targetNode, groupId, event)
		return event
	}

	/**
	 * 查询并解密指定频道消息。
	 * @param {string} node 节点用户名
	 * @param {string} groupId 群组 ID
	 * @param {string} channelId 频道 ID
	 * @param {string} eventId 事件 ID
	 * @returns {Promise<object|undefined>} 解密后的频道消息行
	 */
	async function channelMessage(node, groupId, channelId, eventId) {
		const rows = await modules.queries.listChannelMessages(node, groupId, channelId, {
			eventIds: [eventId],
			decrypt: true,
		})
		return rows.find(row => String(row.eventId).toLowerCase() === String(eventId).toLowerCase())
	}

	/**
	 * 读取群组物化状态。
	 * @param {string} node 节点用户名
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<object>} 物化状态
	 */
	async function stateOf(node, groupId) {
		return (await modules.materialize.getState(node, groupId)).state
	}

	/**
	 * 从物化状态提取活跃成员公钥集合。
	 * @param {object} state 物化状态
	 * @returns {Set<string>} 活跃成员公钥哈希集合
	 */
	function activeMembers(state) {
		return new Set(Object.entries(state.members)
			.filter(([, member]) => member?.status === 'active')
			.map(([pubKeyHash]) => pubKeyHash))
	}

	/**
	 * 读取排序后的 DAG tip ID 列表。
	 * @param {string} node 节点用户名
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<string[]>} 排序后的 DAG tip ID 列表
	 */
	async function tipsOf(node, groupId) {
		return [...modules.dag.computeDagTipIdsFromEvents(await readEvents(node, groupId))].sort()
	}

	/**
	 * 收敛多节点 DAG 至权威节点快照。
	 * @param {string[]} nodes 节点列表
	 * @param {string} authorityNode 权威节点
	 * @param {string} groupId 群组 ID
	 * @returns {Promise<void>}
	 */
	async function converge(nodes, authorityNode, groupId) {
		const peers = nodes.filter(node => node !== authorityNode)
		for (const peer of peers) await federate(peer, [authorityNode], groupId)
		await modules.lifecycle.convergeDagTipsIfAuthorized(authorityNode, groupId)
		await modules.materialize.rebuildAndSaveCheckpoint(authorityNode, groupId)
		for (const peer of peers) await adoptSnapshot(authorityNode, peer, groupId)
	}

	return {
		runTag,
		dataRoot,
		modules,
		groupId: `grp_${runTag}`,
		nodeName,
		readEvents,
		eventIdsOf,
		assertPeersConverged,
		federate,
		gossipAll,
		adoptSnapshot,
		joinGroup,
		postMessage,
		channelMessage,
		stateOf,
		activeMembers,
		tipsOf,
		converge,
	}
}
