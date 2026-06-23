/**
 * 共享后端集成测试 bootstrap（Deno）。
 * Shell 测试 harness 应基于此模块，避免各自重复 init / config.json 逻辑。
 */
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { set_start } from 'fount/server/base.mjs'
import { init } from 'fount/server/server.mjs'

/** @typedef {{ Web?: boolean, IPC?: boolean, Tray?: boolean, DiscordRPC?: boolean, Base?: boolean, P2P?: boolean }} TestStarts */

const DEFAULT_STARTS = {
	Web: false,
	IPC: false,
	Tray: false,
	DiscordRPC: false,
	Base: false,
	P2P: false,
}

/**
 * @typedef {object} StartTestServerOpts
 * @property {string} username 测试用户名
 * @property {string} [dataDir] 数据目录；省略则使用临时目录
 * @property {number} [port=18931] config.json 端口
 * @property {TestStarts} [starts] server starts 覆盖
 * @property {boolean} [minP2pNode=false] 初始化离线 node 身份（无 MQTT/Trystero）
 * @property {string[]} [loadParts] loadPart 列表（相对 parts 路径）
 * @property {(username: string) => Promise<void>} [afterInit] init 后钩子
 */

/**
 * 写入 config.json 并启动 fount server。
 * @param {StartTestServerOpts} opts 启动选项
 * @returns {Promise<{ dataDir: string, username: string }>} 数据目录与用户名
 */
export async function startTestServer(opts) {
	const dataDir = opts.dataDir ?? join(tmpdir(), `fount_test_${Date.now().toString(36)}`)
	fs.rmSync(dataDir, { recursive: true, force: true })
	fs.mkdirSync(dataDir, { recursive: true })
	fs.writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
		port: opts.port ?? 18931,
		data: {
			users: {
				[opts.username]: {
					username: opts.username,
					auth: {
						userId: 'test',
						password: 'test',
						loginAttempts: 0,
						lockedUntil: null,
						refreshTokens: [],
					},
					jobs: {},
					locales: [],
					defaultParts: {},
					timers: {},
				},
			},
			revokedTokens: {},
			apiKeys: {},
		},
	}, null, '\t'))

	set_start()
	const okay = await init({
		/** @returns {never} 测试态不应触发重启 */
		restartor: () => process.exit(131),
		data_path: dataDir,
		starts: opts.starts ?? DEFAULT_STARTS,
	})
	if (!okay) throw new Error('server init failed')

	if (opts.minP2pNode) {
		const { initNode, isNodeInitialized } = await import('fount/scripts/p2p/node/instance.mjs')
		const { createFountEntityStore } = await import('fount/server/p2p_server/entity_store.mjs')
		if (!isNodeInitialized()) {
			const nodeDir = join(dataDir, 'p2p', 'node')
			fs.mkdirSync(nodeDir, { recursive: true })
			initNode({ nodeDir, entityStore: createFountEntityStore() })
		}
	}

	if (opts.loadParts?.length) {
		const { loadPart } = await import('fount/server/parts_loader.mjs')
		for (const part of opts.loadParts)
			await loadPart(opts.username, part)
	}

	if (opts.afterInit)
		await opts.afterInit(opts.username)

	return { dataDir, username: opts.username }
}

/**
 * 单文件内复用的惰性 server 启动器。
 * @param {StartTestServerOpts} opts 启动选项
 * @returns {() => Promise<{ dataDir: string, username: string }>} 惰性启动函数
 */
export function createTestServerBoot(opts) {
	/** @type {Promise<{ dataDir: string, username: string }> | null} */
	let boot = null
	return () => boot ??= startTestServer(opts)
}

/**
 * 无 Web 的 headless fount 数据根（多用户联邦仿真等场景）。
 * 调用方负责创建 dataPath 目录；本函数只写入最小 config 并 init + 离线 P2P node。
 * @param {string} dataPath 数据根目录
 * @returns {Promise<void>}
 */
export async function bootHeadlessDataRoot(dataPath) {
	fs.mkdirSync(dataPath, { recursive: true })
	fs.writeFileSync(join(dataPath, 'config.json'), JSON.stringify({
		port: 18931,
		data: { users: {}, revokedTokens: {}, apiKeys: {} },
	}, null, '\t'))

	set_start()
	const okay = await init({
		/** @returns {never} 测试态不应触发重启 */
		restartor: () => process.exit(131),
		data_path: dataPath,
		starts: DEFAULT_STARTS,
	})
	if (!okay) throw new Error('server init failed')

	const { initNode, isNodeInitialized } = await import('fount/scripts/p2p/node/instance.mjs')
	const { createFountEntityStore } = await import('fount/server/p2p_server/entity_store.mjs')
	if (!isNodeInitialized()) {
		const nodeDir = join(dataPath, 'p2p', 'node')
		fs.mkdirSync(nodeDir, { recursive: true })
		initNode({ nodeDir, entityStore: createFountEntityStore() })
	}
}
