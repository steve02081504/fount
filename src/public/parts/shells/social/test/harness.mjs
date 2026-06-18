/**
 * Social 后端集成测试 harness（Deno）。
 *
 * 复测入口：
 *   deno test --no-check --allow-all src/public/parts/shells/social/test/
 *
 * 设计：以最小 starts（关闭 IPC/Web/Tray/DiscordRPC/Base）启动 fount server，
 * 将 data_path 指向本目录下 .data（gitignored），从而获得可用的
 * getUserDictionary / loadData / saveData，进而对 social 后端真实写盘链路做集成测试。
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const DATA_DIR = join(tmpdir(), `fount_social_test_${Date.now().toString(36)}`)
/**
 *
 */
export const TEST_USER = 'social-test-user'

// Deno 对未处理的 promise rejection 默认静默 exit(1)，会吞掉真实错误（如 bootstrap 内 import 失败）。
// harness 显式打印 reason+stack，避免后人再被"unhandledRejection"无信息退出困住。
globalThis.addEventListener?.('unhandledrejection', ev => {
	console.error('[harness] unhandledrejection:', ev?.reason?.stack || ev?.reason)
})

/** 在 init 之前写好 config.json，使测试用户已注册。 */
function prepareDataDir() {
	fs.rmSync(DATA_DIR, { recursive: true, force: true })
	fs.mkdirSync(DATA_DIR, { recursive: true })
	const config = {
		port: 18931,
		data: {
			users: {
				[TEST_USER]: {
					username: TEST_USER,
					auth: { userId: 'test', password: 'test', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
					jobs: {},
					locales: [],
					defaultParts: {},
					timers: {},
				},
			},
			revokedTokens: {},
			apiKeys: {},
		},
	}
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify(config, null, '\t'))
}

let bootstrapped = null

/**
 * 启动 server（每个进程仅一次）并准备测试用户的联邦 identity + social 时间线。
 * @returns {Promise<{ username: string, operator: string }>} 测试上下文
 */
export function bootstrap() {
	return bootstrapped ??= (async () => {
		prepareDataDir()
		set_start()
		const okay = await init({
			/** @returns {never} 测试态不应触发重启 */
			restartor: () => process.exit(131),
			data_path: DATA_DIR,
			// P2P 默认 true（server.mjs）：会拉起 MQTT/Trystero 后台任务，与在线 NodeA 冲突并产生
			// unhandledRejection 致 Deno.exit(1)。social 后端测试按设计离线运行（fanout 返回 0），故全部关闭。
			starts: { Web: false, IPC: false, Tray: false, DiscordRPC: false, Base: false, P2P: false },
		})
		if (!okay) throw new Error('server init failed')

		const { ensureOperatorPubKey, resolveOperatorEntityHashForUser } = await import('../../../../../server/p2p_server/operator_identity.mjs')
		const { ensureOperatorSocialReady } = await import('../src/lib/bootstrap.mjs')
		const { registerShellPartpath } = await import('../../../../../scripts/p2p/part_path_registry.mjs')
		const { initNode, isNodeInitialized } = await import('../../../../../scripts/p2p/node/instance.mjs')
		const { createFountEntityStore } = await import('../../../../../server/p2p_server/entity_store.mjs')
		const { registerOperatorEntityHashProvider, registerReplicaUsernamesProvider, registerFollowingScanProvider } =
			await import('../../../../../scripts/p2p/social/follower_index_registry.mjs')
		const { registerAgentCharResolver, registerListLocalAgentsProvider } =
			await import('../../../../../scripts/p2p/entity/hosting_registry.mjs')
		const { scanLocalAgentEntitiesFromChars } = await import('../../../../../scripts/p2p/entity/hosting.mjs')
		const { resolveAgentCharPartName } = await import('../../../../../server/p2p_server/agent_resolve.mjs')
		const { getAllUserNames, getUserDictionary } = await import('../../../../../server/auth.mjs')
		const { getTimelineMaterialized } = await import('../src/timeline/materialize.mjs')
		const path = await import('node:path')

		// P2P 关闭时 initP2PServer 不会跑（它会拉起 ensureUserRoom 联网）。但 operator/entity 身份解析
		// 依赖 node 身份（nodeDir）。这里只做最小 node 初始化（identity + entityStore，无 MQTT/Trystero）。
		if (!isNodeInitialized()) {
			const path = await import('node:path')
			const { mkdir } = await import('node:fs/promises')
			const nodeDir = path.join(DATA_DIR, 'p2p', 'node')
			await mkdir(nodeDir, { recursive: true })
			initNode({ nodeDir, entityStore: createFountEntityStore() })
		}

		// social fanout 经 getShellPartpath('social') 解析 partpath；注册后离线 fanout 自然返回 0。
		// 复刻 social/main.mjs Load 的注册：write-auth（agent 托管 operator 绑定）、follower index 依赖这些 provider。
		registerShellPartpath('social', 'shells/social')
		registerReplicaUsernamesProvider(getAllUserNames)
		registerOperatorEntityHashProvider(resolveOperatorEntityHashForUser)
		registerFollowingScanProvider(async username => {
			const operator = await resolveOperatorEntityHashForUser(username)
			if (!operator) return []
			return (await getTimelineMaterialized(username, operator)).following
		})
		// 本机 agent 实体（chars/ 下）解析：write-auth 的 agent 托管 operator 绑定依赖（Chat Load 通常注册）。
		registerAgentCharResolver(resolveAgentCharPartName)
		registerListLocalAgentsProvider(username => scanLocalAgentEntitiesFromChars(username, getUserDictionary, fs, path))
		await ensureOperatorPubKey(TEST_USER)
		const operator = await resolveOperatorEntityHashForUser(TEST_USER)
		if (!operator) throw new Error('operator entityHash not resolved after ensureOperatorPubKey')
		await ensureOperatorSocialReady(TEST_USER)
		return { username: TEST_USER, operator }
	})()
}

/**
 * 生成一个由独立密钥种子签名的远程时间线事件（用于 ingest 边界测试）。
 * @param {Uint8Array} secretKey 32B 种子
 * @param {string} ownerEntityHash 时间线 owner（决定 groupId）
 * @param {object} event { type, content, prev_event_ids?, hlc?, timestamp? }
 * @returns {Promise<object>} 签名事件
 */
export async function makeRemoteSignedEvent(secretKey, ownerEntityHash, event) {
	const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
	const { signTimelineEvent } = await import('../../../../../scripts/p2p/timeline/append_core.mjs')
	const { timelineGroupId } = await import('../../../../../scripts/p2p/social_namespace.mjs')
	const sender = pubKeyHash(publicKeyFromSeed(secretKey))
	const base = {
		type: event.type,
		groupId: timelineGroupId(ownerEntityHash),
		sender,
		charId: event.charId ?? null,
		timestamp: event.timestamp ?? Date.now(),
		hlc: event.hlc ?? { wall: Date.now(), counter: 0, node: sender.slice(0, 8) },
		prev_event_ids: event.prev_event_ids ?? [],
		content: event.content ?? {},
		node_id: event.node_id ?? 'remote-test',
	}
	return signTimelineEvent(base, secretKey)
}

/** @returns {Uint8Array} 32 字节随机种子 */
export function randomSeed() {
	return new Uint8Array(Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))))
}

/**
 * 以连通 DAG（每条 prev 指向上一条 id）顺序签名并 ingest 一串远程事件，
 * 模拟真实联邦：单作者时间线是连通链（避免 retention 把脱链事件裁掉）。
 * @param {string} username 本地 replica
 * @param {Uint8Array} seed 远程作者种子
 * @param {string} ownerEntityHash 时间线 owner
 * @param {object[]} eventSpecs [{ type, content }]
 * @returns {Promise<object[]>} 已 ingest 的签名事件
 */
export async function seedRemoteTimeline(username, seed, ownerEntityHash, eventSpecs) {
	const { ingestRemoteTimelineEvent } = await import('../src/timeline/sync.mjs')
	const signed = []
	let prevId = null
	let wall = Date.now() - eventSpecs.length
	for (const spec of eventSpecs) {
		const event = await makeRemoteSignedEvent(seed, ownerEntityHash, {
			...spec,
			prev_event_ids: prevId ? [prevId] : [],
			hlc: { wall: wall++, counter: 0, node: 'remote-test' },
		})
		if (!await ingestRemoteTimelineEvent(username, ownerEntityHash, event))
			throw new Error(`seedRemoteTimeline: ingest rejected ${spec.type}`)
		prevId = event.id
		signed.push(event)
	}
	return signed
}
