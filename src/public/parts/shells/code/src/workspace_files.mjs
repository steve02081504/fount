/** 工作区文件浏览与文本编辑：路径边界、版本校验及串行保存。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { createTargetExecutor } from '../../../plugins/file-operations/src/target.mjs'

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
const WORKSPACE_EDITOR_MAX_BYTES = 1024 * 1024

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
 * 注册工作区文件树及编辑器读写端点。
 * @param {import('npm:express').Router} router - Shell router.
 * @returns {void} No return value.
 */
export function setWorkspaceFileEndpoints(router) {
	// 工作区文件树（仅返回工作区相对路径；嵌套目录按需加载）
	router.get('/api/parts/shells\\:code/workspace/directory', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.query)
		const relative = workspaceRelativePath(req.query.path, { allowEmpty: true })
		const { executor } = await resolveWorkspaceFile(username, workTarget, relative || '.')
		const entries = await executor.listDir(relative || '.')
		res.json({
			path: relative,
			entries: entries.slice(0, 2000).map(entry => ({
				name: entry.name,
				path: relative ? `${relative}/${entry.name}` : entry.name,
				isDirectory: Boolean(entry.isDirectory),
				isFile: Boolean(entry.isFile),
			})),
		})
	})

	// 读取编辑器文本与内容哈希版本；限制大小并拒绝二进制/无效 UTF-8。
	router.get('/api/parts/shells\\:code/workspace/file', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workTarget = parseWorkdir(req.query)
		const relative = workspaceRelativePath(req.query.path)
		const { executor, absolute } = await resolveWorkspaceFile(username, workTarget, relative)
		const stat = await executor.statEntry(absolute)
		if (!stat?.isFile) throw httpError(404, 'Workspace file not found.')
		if (stat.size > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 1 MiB editor limit.')
		const bytes = await executor.readFileBuffer(absolute)
		if (bytes.length > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 1 MiB editor limit.')
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
		if (bytes.length > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 1 MiB editor limit.')
		if (!/^[a-f0-9]{64}$/.test(version)) throw httpError(400, 'A valid file version is required.')
		const { executor, absolute } = await resolveWorkspaceFile(username, workTarget, relative)
		const lockKey = `${username}\0${workTarget.machine}\0${absolute}`
		const result = await withWorkspaceFileWriteLock(lockKey, async () => {
			const stat = await executor.statEntry(absolute)
			if (!stat?.isFile) throw httpError(404, 'Workspace file not found.')
			if (stat.size > WORKSPACE_EDITOR_MAX_BYTES) throw httpError(413, 'File exceeds the 1 MiB editor limit.')
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
