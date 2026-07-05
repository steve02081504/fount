/**
 * fount 测试节点统一启动（同进程集成测试 + node worker 子进程共用）。
 */
import 'fount/scripts/test/env.mjs'

import crypto from 'node:crypto'
import fs, { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { set_start } from 'fount/server/base.mjs'
import { set_sentry_enabled } from 'fount/server/sentry_state.mjs'
import { init } from 'fount/server/server.mjs'

import { HEADLESS_CONFIG_PORT } from '../core/ports.mjs'

/** 测试节点用户默认 locale（与 `localesFromRequest` 无用户偏好时的回退一致）。 */
const DEFAULT_TEST_USER_LOCALES = ['zh-CN', 'en-UK']

/**
 * server starts 预设选项。
 * @typedef {{ Web?: boolean, IPC?: boolean, Tray?: boolean, DiscordRPC?: boolean, Base?: boolean | object, P2P?: boolean }} TestStarts
 */

/**
 * writeNodeConfig 的配置选项。
 * @typedef {object} WriteNodeConfigOpts
 * @property {number} [port=HEADLESS_CONFIG_PORT] config.json 端口（web: false 时不绑定 TCP，仅占位）
 * @property {string} username 用户名
 * @property {string} [apiKey] API key 明文；提供时写入 API key 认证
 * @property {string} [password='test'] 无 apiKey 时的密码认证
 * @property {string} [userId='test'] 无 apiKey 时的 userId
 * @property {boolean} [emptyUsers=false] 仅写入空 users（headless 仿真根）
 */

/**
 * 写入或更新节点 config.json。
 * @param {string} dataPath data 根目录
 * @param {WriteNodeConfigOpts} options 配置选项
 * @returns {void}
 */
export function writeNodeConfig(dataPath, options) {
	const port = options.port ?? HEADLESS_CONFIG_PORT
	const { username, apiKey, emptyUsers } = options
	const configPath = join(dataPath, 'config.json')
	const config = existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {
		port,
		listen: null,
		prelaunch: { heapSize: 0 },
		https: {
			enabled: false,
			keyFile: './data/ssl/key.pem',
			certFile: './data/ssl/cert.pem',
		},
		data: { users: {}, apiKeys: {}, revokedTokens: {} },
	}

	config.port = port

	if (emptyUsers) {
		config.data.users = {}
		config.data.apiKeys = {}
		config.data.revokedTokens = {}
	}
	else if (apiKey) {
		const key = apiKey
		const apiKeyHash = crypto.createHash('sha256').update(key).digest('hex')
		const apiJti = `${username}-test-key-jti`

		if (!config.data.users[username]) 
			config.data.users[username] = {
				username,
				createdAt: Date.now(),
				auth: {
					userId: `${username}-id`,
					password: null,
					loginAttempts: 0,
					lockedUntil: null,
					refreshTokens: [],
					apiKeys: [],
					webauthnCredentials: [],
				},
				jobs: {},
				locales: [...DEFAULT_TEST_USER_LOCALES],
				defaultParts: {},
				timers: {},
			}
		
		const user = config.data.users[username]
		if (!user.auth.apiKeys.some(row => row.jti === apiJti))
			user.auth.apiKeys.push({
				jti: apiJti,
				description: `${username} test key`,
				createdAt: Date.now(),
				lastUsed: null,
				prefix: key.slice(0, 7),
			})

		config.data.apiKeys[apiKeyHash] = { username, jti: apiJti }

		fs.mkdirSync(join(dataPath, 'users', username, 'settings'), { recursive: true })
		fs.mkdirSync(join(dataPath, 'users', username, 'entities'), { recursive: true })
	}
	else
		config.data.users[username] = {
			username,
			auth: {
				userId: options.userId ?? 'test',
				password: options.password ?? 'test',
				loginAttempts: 0,
				lockedUntil: null,
				refreshTokens: [],
			},
			jobs: {},
			locales: [...DEFAULT_TEST_USER_LOCALES],
			defaultParts: {},
			timers: {},
		}

	fs.mkdirSync(dataPath, { recursive: true })
	fs.mkdirSync(join(dataPath, 'p2p', 'chunks'), { recursive: true })
	fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'))
}

/**
 * 测试用 server starts 预设。
 * @param {object} [options] 选项
 * @param {boolean} [options.web=false] 是否启动 Web
 * @param {boolean} [options.p2p=false] 是否启动 P2P
 * @param {boolean} [options.jobs=false] Base.Jobs（仅 web 时有效）
 * @returns {TestStarts} starts 对象
 */
export function defaultTestStarts({ web = false, p2p = false, jobs = false } = {}) {
	if (!web)
		return {
			IPC: false,
			Tray: false,
			DiscordRPC: false,
			Web: false,
			P2P: p2p,
			Base: false,
		}
	return {
		IPC: false,
		Tray: false,
		DiscordRPC: false,
		Web: true,
		P2P: p2p,
		Base: {
			Jobs: jobs,
			Timers: false,
			Idle: false,
			AutoUpdate: false,
		},
	}
}

/**
 * 启动 fount server（须先 writeNodeConfig）。
 * @param {object} options 选项
 * @param {string} options.dataPath data 根目录
 * @param {() => never} [options.restarter] 重启回调
 * @param {TestStarts} [options.starts] server starts；省略则使用测试默认预设
 * @param {boolean} [options.needsOutput] 是否启用带输出的 server init 行为
 * @param {import('../../scripts/p2p/node/signaling_config.mjs').SignalingRuntimeConfig} [options.p2pSignaling] initNode 信令配置
 * @returns {Promise<boolean>} init 是否成功
 */
export async function initFountNode({ dataPath, restarter, starts, needsOutput, p2pSignaling }) {
	process.env.FOUNT_DENO_START_TIME ??= new Date().toISOString()
	set_sentry_enabled(false)
	set_start()
	starts ??= defaultTestStarts()
	return await init({
		starts,
		needs_output: needsOutput,
		restartor: restarter ?? (() => process.exit(131)),
		data_path: dataPath,
		...p2pSignaling ? { p2p_signaling: p2pSignaling } : {},
	})
}

/**
 * 同进程 bootInProcess 启动选项。
 * @typedef {object} BootInProcessOpts
 * @property {string} dataPath data 根目录
 * @property {number} [port] config 端口
 * @property {string} username 用户名
 * @property {string} [apiKey] API key（子进程 Web 节点）
 * @property {boolean} [web=false] 是否启动 Web
 * @property {boolean} [p2p=false] 是否启动 P2P
 * @property {boolean} [jobs=false] Base.Jobs（仅 web 时有效）
 * @property {boolean} [minP2pNode=false] 初始化离线 P2P node 身份
 * @property {string[]} [loadParts] loadPart 列表
 * @property {string} [bootstrap] bootstrap 模块绝对路径
 * @property {(username: string) => Promise<void>} [afterInit] init 后钩子
 * @property {TestStarts} [starts] 精确透传给 `init()`；省略则根据 web/p2p/jobs 使用测试预设
 * @property {boolean} [needsOutput] 透传给 `init()` 的 `needs_output`
 * @property {string} [p2pRelayUrl] 测试 loopback nostr relay（P2P live 注入）
 * @property {boolean} [resetData=false] 启动前清空 dataPath
 */

/**
 * 同进程启动测试节点（集成测试 / node worker）。
 * @param {BootInProcessOpts} options 启动选项
 * @returns {Promise<{ dataPath: string, username: string }>} 数据目录与用户名
 */
export async function bootInProcess(options) {
	if (options.resetData)
		fs.rmSync(options.dataPath, { recursive: true, force: true })

	writeNodeConfig(options.dataPath, {
		port: options.port,
		username: options.username,
		...options.apiKey ? { apiKey: options.apiKey } : {},
	})
	const starts = options.starts ?? defaultTestStarts(options)
	const p2pSignaling = options.p2pRelayUrl
		? (await import('./p2p_signaling.mjs')).testSignalingFromRelayUrls(options.p2pRelayUrl)
		: options.p2pSignaling

	if (!await initFountNode({
		dataPath: options.dataPath,
		starts,
		needsOutput: options.needsOutput,
		...p2pSignaling ? { p2pSignaling } : {},
	}))
		throw new Error('server init failed')

	if (options.minP2pNode)
		await ensureMinP2pNode(options.dataPath)

	if (options.loadParts?.length) {
		const { loadPart } = await import('fount/server/parts_loader.mjs')
		for (const part of options.loadParts)
			await loadPart(options.username, part)
	}

	if (starts.P2P && options.loadParts?.length) {
		const { ensureUserRoom } = await import('fount/scripts/p2p/user_room.mjs')
		await ensureUserRoom({ replicaUsername: options.username })
	}

	if (options.bootstrap) {
		const module = await import(pathToFileURL(options.bootstrap).href)
		await module.default(options.username)
	}

	if (options.afterInit)
		await options.afterInit(options.username)

	return { dataPath: options.dataPath, username: options.username }
}

/**
 * startTestServer / createTestServerBoot 选项。
 * @typedef {object} StartTestServerOpts
 * @property {string} username 测试用户名
 * @property {string} [dataDir] 数据目录
 * @property {number} [port=HEADLESS_CONFIG_PORT] config.json 端口（web: false 集成测试占位，不绑定 TCP）
 * @property {boolean} [minP2pNode=false] 初始化离线 node
 * @property {string[]} [loadParts] loadPart 列表
 * @property {(username: string) => Promise<void>} [afterInit] init 后钩子
 */

/**
 * 写入 config 并同进程启动 fount（集成测试）。
 * @param {StartTestServerOpts} options 启动选项
 * @returns {Promise<{ dataDir: string, username: string }>} 数据目录与用户名
 */
export async function startTestServer(options) {
	const dataDir = options.dataDir ?? join(tmpdir(), `fount_test_${Date.now().toString(36)}`)
	const row = await bootInProcess({
		dataPath: dataDir,
		port: options.port ?? HEADLESS_CONFIG_PORT,
		username: options.username,
		web: false,
		p2p: false,
		minP2pNode: options.minP2pNode ?? false,
		loadParts: options.loadParts,
		afterInit: options.afterInit,
		resetData: true,
	})
	return { dataDir: row.dataPath, username: row.username }
}

/**
 * 单文件内复用的惰性 server 启动器。
 * @param {StartTestServerOpts} options 启动选项
 * @returns {() => Promise<{ dataDir: string, username: string }>} 惰性启动函数
 */
export function createTestServerBoot(options) {
	let boot = null
	return () => boot ??= startTestServer(options)
}

/**
 * 无 Web 的 headless fount 数据根（联邦仿真等）。
 * @param {string} dataPath 数据根目录
 * @returns {Promise<void>}
 */
export async function bootHeadlessDataRoot(dataPath) {
	fs.mkdirSync(dataPath, { recursive: true })
	writeNodeConfig(dataPath, { port: HEADLESS_CONFIG_PORT, username: 'headless-root', emptyUsers: true })
	if (!await initFountNode({
		dataPath,
	}))
		throw new Error('server init failed')
	await ensureMinP2pNode(dataPath)
}

/**
 * 在无 Web 场景下初始化最小 P2P node 身份。
 * @param {string} dataPath data 根目录
 * @returns {Promise<void>}
 */
async function ensureMinP2pNode(dataPath) {
	const { isNodeInitialized } = await import('fount/scripts/p2p/node/instance.mjs')
	const { createFountEntityStore } = await import('fount/server/p2p_server/entity_store.mjs')
	const { initTestP2pNode } = await import('fount/scripts/p2p/test/helpers/node.mjs')
	if (!isNodeInitialized()) {
		const nodeDir = join(dataPath, 'p2p', 'node')
		fs.mkdirSync(nodeDir, { recursive: true })
		initTestP2pNode({ nodeDir, entityStore: createFountEntityStore() })
	}
}
