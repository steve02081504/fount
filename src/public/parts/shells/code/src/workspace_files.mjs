/** 工作区文件浏览与文本编辑：路径边界、版本校验及串行保存。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import * as mime from 'npm:mime-types'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { createTargetExecutor } from '../../../plugins/file-operations/src/target.mjs'

import { workspaceWatchScript } from './workspace_watch.mjs'

/**
 * 从请求参数解析目标工作区（machine 字符串化，"0" = 本机）。
 * @param {{machine?: string|number, workdir?: string, workspace?: string}} source - 请求数据。
 * @returns {{machine: string, path: string}} 目标工作区。
 */
export function parseWorkdir(source) {
	const machine = String(source?.machine ?? '0')
	const path = String(source?.workdir ?? source?.workspace ?? '')
	return { machine, path }
}

/** 工作区编辑器大小上限，保护远程 RPC 负载和浏览器内存。 */
const WORKSPACE_EDITOR_MAX_BYTES = 16 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const WORKSPACE_FILE_CHUNK_MAX_BYTES = 256 * 1024
const WORKSPACE_FILE_SNAPSHOTS_MAX_BYTES = 32 * 1024 * 1024
const WORKSPACE_FILE_SNAPSHOTS_MAX_ENTRIES = 256
const WORKSPACE_FILE_SNAPSHOT_TTL_MS = 30_000
/** @type {Map<string, {bytes: Buffer, version: string, expiresAt: number}>} */
const workspaceFileSnapshots = new Map()
let workspaceFileSnapshotsBytes = 0

/**
 * 清理过期快照，并按最近使用顺序腾出缓存空间。
 * @param {number} requiredBytes - 新快照所需字节数。
 * @returns {void} No return value.
 */
function makeWorkspaceFileSnapshotRoom(requiredBytes) {
	const now = Date.now()
	workspaceFileSnapshots.forEach((snapshot, key) => {
		if (snapshot.expiresAt <= now) {
			workspaceFileSnapshots.delete(key)
			workspaceFileSnapshotsBytes -= snapshot.bytes.length
		}
	})
	while (workspaceFileSnapshotsBytes + requiredBytes > WORKSPACE_FILE_SNAPSHOTS_MAX_BYTES || workspaceFileSnapshots.size >= WORKSPACE_FILE_SNAPSHOTS_MAX_ENTRIES) {
		const oldestKey = workspaceFileSnapshots.keys().next().value
		if (oldestKey === undefined) break
		const oldest = workspaceFileSnapshots.get(oldestKey)
		workspaceFileSnapshots.delete(oldestKey)
		workspaceFileSnapshotsBytes -= oldest.bytes.length
	}
}

/**
 * 保存一份短期一致性快照。
 * @param {string} key - 用户与规范路径键。
 * @param {Buffer} bytes - 文件字节。
 * @param {string} version - 内容哈希。
 * @returns {void} No return value.
 */
function cacheWorkspaceFileSnapshot(key, bytes, version) {
	if (bytes.length > WORKSPACE_FILE_SNAPSHOTS_MAX_BYTES) return
	const previous = workspaceFileSnapshots.get(key)
	if (previous) workspaceFileSnapshotsBytes -= previous.bytes.length
	workspaceFileSnapshots.delete(key)
	makeWorkspaceFileSnapshotRoom(bytes.length)
	workspaceFileSnapshots.set(key, { bytes, version, expiresAt: Date.now() + WORKSPACE_FILE_SNAPSHOT_TTL_MS })
	workspaceFileSnapshotsBytes += bytes.length
}

/**
 * 取出有效快照、刷新其闲置期限并更新 LRU 顺序。
 * @param {string} key - 用户与规范路径键。
 * @param {string} version - 请求版本。
 * @returns {Buffer|null} 匹配快照。
 */
function getWorkspaceFileSnapshot(key, version) {
	const snapshot = workspaceFileSnapshots.get(key)
	if (!snapshot) return null
	if (snapshot.expiresAt <= Date.now()) {
		workspaceFileSnapshots.delete(key)
		workspaceFileSnapshotsBytes -= snapshot.bytes.length
		return null
	}
	if (snapshot.version !== version) return null
	// 分块读取是多次请求，期限按闲置时间算，否则大文件会在传输中途过期。
	snapshot.expiresAt = Date.now() + WORKSPACE_FILE_SNAPSHOT_TTL_MS
	workspaceFileSnapshots.delete(key)
	workspaceFileSnapshots.set(key, snapshot)
	return snapshot.bytes
}

/** 在当前进程内串行执行编辑器保存的读取、比较和写入。 @type {Map<string, Promise<void>>} */
const workspaceFileWrites = new Map()

/**
 * 验证用户提供的工作区相对路径。
 * @param {unknown} value - Path from the API.
 * @param {{allowEmpty?: boolean}} [options] - Whether the workspace root is valid.
 * @returns {string} Normalized slash-separated path.
 */
export function workspaceRelativePath(value, { allowEmpty = false } = {}) {
	const raw = String(value ?? '')
	if (!raw && allowEmpty) return ''
	if (!raw || raw.includes('\0') || /^[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw))
		throw httpError(400, 'A workspace-relative path is required.')
	const parts = raw.replaceAll('\\', '/').split('/')
	if (parts.some(part => !part || part === '.' || part === '..'))
		throw httpError(400, 'Invalid workspace-relative path.')
	return parts.join('/')
}

/**
 * 检查规范化目标路径是否位于规范化工作区根目录内。
 * @param {string} root - Canonical workspace path.
 * @param {string} candidate - Canonical candidate path.
 * @returns {boolean} True when contained.
 */
function isWithinWorkspace(root, candidate) {
	const windows = /^[A-Za-z]:[\\/]/.test(root)
	/**
	 * @param {string} value - Path to normalize.
	 * @returns {string} Comparable path.
	 */
	const normalize = value => {
		const normalized = value.replaceAll('\\', '/').replace(/\/$/, '')
		return windows ? normalized.toLowerCase() : normalized
	}
	const base = normalize(root)
	const child = normalize(candidate)
	return child === base || child.startsWith(`${base}/`)
}

/**
 * 在目标机器文件系统中解析并验证工作区相对路径。
 * @param {string} username - Authenticated user.
 * @param {{machine: string, path: string}} workTarget - Workspace target.
 * @param {string} relative - Validated relative path.
 * @returns {Promise<{executor: import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t, root: string, absolute: string}>} Verified target.
 */
async function resolveWorkspaceFile(username, workTarget, relative) {
	if (!workTarget.path) throw httpError(400, 'A workspace is required.')
	const executor = createTargetExecutor(username, { machine: workTarget.machine, workdir: workTarget.path })
	let root
	let absolute
	try {
		root = await executor.realpath('.')
		absolute = await executor.realpath(relative)
	}
	catch {
		throw httpError(404, 'Workspace file not found.')
	}
	if (!isWithinWorkspace(root, absolute)) throw httpError(403, 'Path escapes the workspace.')
	return { executor, root, absolute }
}

/**
 * 在服务器进程中串行执行同一目标文件的编辑器保存。
 * @param {string} key - Target file lock key.
 * @param {() => Promise<unknown>} callback - Save operation.
 * @returns {Promise<unknown>} Save result.
 */
async function withWorkspaceFileWriteLock(key, callback) {
	const previous = workspaceFileWrites.get(key) || Promise.resolve()
	const current = previous.catch(() => {}).then(callback)
	workspaceFileWrites.set(key, current)
	try { return await current }
	finally { if (workspaceFileWrites.get(key) === current) workspaceFileWrites.delete(key) }
}

/**
 * 生成用于编辑器乐观并发保存的 SHA-256 版本标识。
 * @param {Buffer} bytes - File bytes.
 * @returns {string} Version token.
 */
function workspaceFileVersion(bytes) {
	return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 注册工作区文件树、编辑器读写端点及文件变化订阅。
 * @param {import('npm:express').Router} router - Shell router.
 * @returns {void} No return value.
 */
export function setWorkspaceFileEndpoints(router) {
	// 工作区文件变化订阅：前端提交要监听的目录，服务端只报告「有变化」，由前端重新读取
	router.ws('/ws/parts/shells\\:code/workspace/watch', authenticate, (ws, req) => {
		const { username } = getUserByReq(req)
		let subscription
		let closed = false, subscribed = false
		/**
		 * 发送一帧（连接已关闭时忽略）。
		 * @param {string} type - 帧类型。
		 * @param {string} reason 结束原因。
		 * @returns {void}
		 */
		const send = (type, reason) => { if (!closed && ws.readyState === 1) ws.send(JSON.stringify({ type, reason })) }
		let lastPong = Date.now()
		ws.on('pong', () => { lastPong = Date.now() })
		const heartbeat = setInterval(() => {
			if (Date.now() - lastPong > 30000) { ws.terminate(); return }
			if (ws.readyState === 1) { ws.ping(); send('heartbeat') }
		}, 10000)
		ws.on('close', () => {
			closed = true
			clearInterval(heartbeat)
			subscription?.dispose()
		})
		ws.on('message', async raw => {
			if (subscribed) return
			subscribed = true
			try {
				const data = JSON.parse(String(raw))
				const target = parseWorkdir(data)
				if (!target.path || !Array.isArray(data.paths) || data.paths.length > 128) throw httpError(400, 'Invalid workspace watch request')
				const paths = data.paths.map(path => workspaceRelativePath(path, { allowEmpty: true }))
				const executor = createTargetExecutor(username, { machine: target.machine, workdir: target.path })
				subscription = executor.openCallbackSession(workspaceWatchScript({ workdir: target.path, paths }), {
					/**
					 * 处理会话回调。
					 * @param {object} frame 会话事件帧。
					 * @returns {any} 操作结果。
					 */
					onEvent: frame => { if (frame?.type === 'change') send('change') },
					/**
					 * 处理会话回调。
					 * @param {string} reason 结束原因。
					 * @returns {any} 操作结果。
					 */
					onClose: reason => {
						if (closed) return
						const permanent = /setup-error: (Invalid workspace-relative|Path escapes workspace|Too many watched|Workspace unavailable|Workspace watch unavailable)/.test(reason)
						send(permanent ? 'unavailable' : 'disconnected', reason)
						ws.close(permanent ? 1008 : 1013, 'Workspace subscription interrupted')
					},
				})
				await subscription.ready
				if (closed) { subscription.dispose(); return }
				send('ready')
			}
			catch (error) {
				if (closed || ws.readyState !== 1) return
				const permanent = error.http_code === 400 || error instanceof SyntaxError
				send(permanent ? 'unavailable' : 'disconnected', error.reason || 'setup-error')
				ws.close(permanent ? 1008 : 1013, 'Workspace watch unavailable')
			}
		})
	})

	// 工作区文件树（仅返回工作区相对路径；嵌套目录按需加载）
	router.get('/api/parts/shells\\:code/workspace/directory', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.query)
		const relative = workspaceRelativePath(req.query.path, { allowEmpty: true })
		const { executor } = await resolveWorkspaceFile(username, workTarget, relative || '.')
		const offset = Number(req.query.offset ?? 0)
		const limit = Number(req.query.limit ?? 2000)
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000)
			throw httpError(400, 'Invalid workspace directory page.')
		const allEntries = await executor.listDir(relative || '.')
		const entries = allEntries.slice(offset, offset + limit)
		res.json({
			path: relative,
			total: allEntries.length,
			nextOffset: offset + entries.length < allEntries.length ? offset + entries.length : null,
			entries: entries.map(entry => ({
				name: entry.name,
				path: relative ? `${relative}/${entry.name}` : entry.name,
				isDirectory: Boolean(entry.isDirectory),
				isFile: Boolean(entry.isFile),
			})),
		})
	})

	// 读取工作区中的二进制附件；与编辑器共用路径边界检查，但不要求 UTF-8。
	router.get('/api/parts/shells\\:code/workspace/attachment', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.query)
		const relative = workspaceRelativePath(req.query.path)
		const { executor, absolute } = await resolveWorkspaceFile(username, workTarget, relative)
		const stat = await executor.statEntry(absolute)
		if (!stat?.isFile) throw httpError(404, 'Workspace file not found.')
		if (stat.size > ATTACHMENT_MAX_BYTES) throw httpError(413, 'Attachment exceeds the 10 MiB limit.')
		const bytes = await executor.readFileBuffer(absolute)
		if (bytes.length > ATTACHMENT_MAX_BYTES) throw httpError(413, 'Attachment exceeds the 10 MiB limit.')
		res.json({ name: basename(relative), mime_type: mime.lookup(relative) || 'application/octet-stream', buffer: bytes.toString('base64') })
	})

	// 读取编辑器文本；offset/limit 启用字节分块模式，由短期快照维持多次请求间的一致性。
	router.get('/api/parts/shells\\:code/workspace/file', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.query)
		const relative = workspaceRelativePath(req.query.path)
		const { executor, absolute } = await resolveWorkspaceFile(username, workTarget, relative)
		const stat = await executor.statEntry(absolute)
		if (!stat?.isFile) throw httpError(404, 'Workspace file not found.')
		const chunked = req.query.offset !== undefined || req.query.limit !== undefined || req.query.version !== undefined
		if (chunked) {
			const offset = Number(req.query.offset ?? 0)
			const limit = Number(req.query.limit ?? WORKSPACE_FILE_CHUNK_MAX_BYTES)
			if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > WORKSPACE_FILE_CHUNK_MAX_BYTES)
				throw httpError(400, 'Invalid workspace file chunk range.')
			if (!req.query.version && stat.size > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
			const snapshotKey = `${username}\0${workTarget.machine}\0${absolute}`
			let version = String(req.query.version || '')
			let bytes = version ? getWorkspaceFileSnapshot(snapshotKey, version) : null
			if (version && !bytes) throw httpError(409, 'File snapshot expired or version is stale.')
			if (!version) {
				bytes = await executor.readFileBuffer(absolute)
				if (bytes.length > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
				let content
				try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
				catch { throw httpError(415, 'Binary or invalid UTF-8 files cannot be edited.') }
				if (content.includes('\0')) throw httpError(415, 'Binary files cannot be edited.')
				version = workspaceFileVersion(bytes)
				cacheWorkspaceFileSnapshot(snapshotKey, bytes, version)
			}
			if (offset > bytes.length) throw httpError(416, 'Workspace file chunk offset is past end of file.')
			res.json({
				path: relative, offset, totalSize: bytes.length, version,
				data: bytes.subarray(offset, Math.min(offset + limit, bytes.length)).toString('base64'),
			})
			return
		}
		if (stat.size > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
		const bytes = await executor.readFileBuffer(absolute)
		if (bytes.length > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
		let content
		try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
		catch { throw httpError(415, 'Binary or invalid UTF-8 files cannot be edited.') }
		if (content.includes('\0')) throw httpError(415, 'Binary files cannot be edited.')
		res.json({ path: relative, content, version: workspaceFileVersion(bytes) })
	})

	// 乐观并发保存：客户端必须提交读取时的 SHA-256 version。
	router.put('/api/parts/shells\\:code/workspace/file', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.body || {})
		const relative = workspaceRelativePath(req.body?.path)
		const content = req.body?.content
		const version = String(req.body?.version || '')
		if (typeof content !== 'string') throw httpError(400, 'content must be a string.')
		const bytes = Buffer.from(content, 'utf8')
		if (bytes.length > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
		if (!/^[a-f0-9]{64}$/.test(version)) throw httpError(400, 'A valid file version is required.')
		const { executor, absolute } = await resolveWorkspaceFile(username, workTarget, relative)
		const lockKey = `${username}\0${workTarget.machine}\0${absolute}`
		const result = await withWorkspaceFileWriteLock(lockKey, async () => {
			const stat = await executor.statEntry(absolute)
			if (!stat?.isFile) throw httpError(404, 'Workspace file not found.')
			if (stat.size > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 16 MiB editor limit.')
			const current = await executor.readFileBuffer(absolute)
			if (workspaceFileVersion(current) !== version) throw httpError(409, 'File changed since it was opened.', { json: { version: workspaceFileVersion(current) } })
			// Recheck the canonical path immediately before writing, including symlinked parent directories.
			const canonical = await executor.realpath(absolute)
			if (!isWithinWorkspace(await executor.realpath('.'), canonical)) throw httpError(403, 'Path escapes the workspace.')
			await executor.writeTextFile(absolute, content)
			return { path: relative, content, version: workspaceFileVersion(bytes) }
		})
		res.json(result)
	})

}
