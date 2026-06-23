/**
 * fount 测试节点 worker：在子进程中启动 Web server 并保持存活。
 * 由 launch_node.mjs spawn；就绪时向 stdout 打印一行 JSON（含 baseUrl）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { set_start } from '../../server/base.mjs'
import { hosturl, init } from '../../server/server.mjs'

const { values } = parseArgs({
	options: {
		'data-path': { type: 'string' },
		port: { type: 'string' },
		user: { type: 'string' },
		key: { type: 'string' },
		p2p: { type: 'boolean', default: false },
		'load-part': { type: 'string', multiple: true },
		bootstrap: { type: 'string' },
	},
})

const dataPath = values['data-path']
const port = Number(values.port || '8931')
const username = values.user || 'test-user'
const apiKey = values.key || 'test-api-key'
const loadParts = values['load-part'] ?? []

if (!dataPath) {
	console.error('node_worker: --data-path required')
	process.exit(2)
}

/**
 * 写入或更新节点 config.json（端口、用户、API key）。
 * @param {string} root data 根目录
 * @param {number} listenPort 监听端口
 * @param {string} name 用户名
 * @param {string} key API key 明文
 * @returns {void}
 */
function ensureConfig(root, listenPort, name, key) {
	const configPath = `${root}/config.json`
	let config = {}
	try {
		config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
	}
	catch {
		config = {}
	}

	config.port = listenPort
	config.listen ??= null
	config.prelaunch ??= { heapSize: 0 }
	config.https ??= {
		enabled: false,
		keyFile: './data/ssl/key.pem',
		certFile: './data/ssl/cert.pem',
	}
	config.data ??= { users: {}, apiKeys: {}, revokedTokens: {} }
	config.data.apiKeys ??= {}
	config.data.users ??= {}

	const apiKeyHash = crypto.createHash('sha256').update(key).digest('hex')
	const apiJti = `${name}-test-key-jti`

	config.data.users[name] ??= {
		username: name,
		createdAt: Date.now(),
		auth: {
			userId: `${name}-id`,
			password: null,
			loginAttempts: 0,
			lockedUntil: null,
			refreshTokens: [],
			apiKeys: [],
			webauthnCredentials: [],
		},
		jobs: {},
		locales: [],
		defaultParts: {},
		timers: {},
	}
	config.data.users[name].auth ??= {}
	config.data.users[name].auth.apiKeys ??= []
	if (!config.data.users[name].auth.apiKeys.some(row => row?.jti === apiJti))
		config.data.users[name].auth.apiKeys.push({
			jti: apiJti,
			description: `${name} test key`,
			createdAt: Date.now(),
			lastUsed: null,
			prefix: key.slice(0, 7),
		})

	config.data.apiKeys[apiKeyHash] = { username: name, jti: apiJti }

	fs.mkdirSync(root, { recursive: true })
	fs.mkdirSync(`${root}/users/${name}/settings`, { recursive: true })
	fs.mkdirSync(`${root}/users/${name}/entities`, { recursive: true })
	fs.mkdirSync(`${root}/p2p/chunks`, { recursive: true })
	fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'))
}

ensureConfig(dataPath, port, username, apiKey)

set_start()

const ok = await init({
	/**
	 * 测试态不应触发重启。
	 * @returns {never} 收到重启请求时退出
	 */
	restartor: () => process.exit(131),
	data_path: dataPath,
	starts: {
		IPC: false,
		Tray: false,
		DiscordRPC: false,
		Web: true,
		P2P: values.p2p,
		Base: {
			Jobs: false,
			Timers: false,
			Idle: false,
			AutoUpdate: false,
		},
	},
})

if (!ok) {
	console.error('node_worker: init failed')
	process.exit(1)
}

try {
	const { loadPart } = await import('../../server/parts_loader.mjs')
	for (const partpath of loadParts)
		await loadPart(username, partpath)

	if (values.bootstrap) {
		const mod = await import(pathToFileURL(values.bootstrap).href)
		const fn = mod.default ?? mod.bootstrap
		if (typeof fn !== 'function')
			throw new Error(`bootstrap module must export default or bootstrap function: ${values.bootstrap}`)
		await fn(username)
	}
}
catch (bootstrapError) {
	console.error('node_worker: bootstrap failed', bootstrapError)
	process.exit(1)
}

console.log(JSON.stringify({
	ready: true,
	baseUrl: hosturl,
	port,
	username,
	apiKey,
}))

// Base 子系统全关时仅 HTTP 不足以保活事件循环
setInterval(() => { }, 1 << 30)
