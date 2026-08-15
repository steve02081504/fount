/**
 * GitHub Pages 本地静态服务器（与 `.esh/commands/pages-server.mjs` 同规则）。
 * 从原始路径挂载，无需复制/构建；部署流程见 `.github/workflows/pages.yaml`。
 */
import { watch } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import express from 'npm:express'

import { git } from '../../../scripts/git.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

const GITHUB_PAGES_COMMENTS_URL = 'https://steve02081504.github.io/fount/data/comments.json'
/** 与 CI `sed` 对齐的 commit 占位符。 */
export const FOUNT_COMMIT_HASH_PLACEHOLDER = '__FOUNT_COMMIT_HASH__'
/** 与 CI `sed` 对齐的 git 引用占位符（分支名；detached 时为 commit）。 */
export const FOUNT_GIT_REF_PLACEHOLDER = '__FOUNT_GIT_REF__'

let fountVersion = 'unknown'
let fountGitRef = 'master'
/**
 * 刷新 Pages 占位符用的 commit / 分支。
 * @returns {Promise<void>}
 */
async function refreshFountGitMeta() {
	const gitHere = git.withPath(REPO_ROOT)
	fountVersion = await gitHere('rev-parse', 'HEAD') || 'unknown'
	const branch = await gitHere('rev-parse', '--abbrev-ref', 'HEAD')
	fountGitRef = branch && branch !== 'HEAD' ? branch : fountVersion
}

/**
 * 替换 Pages 源里的构建占位符（与 workflows/pages.yaml 一致）。
 * @param {string} source 源文本
 * @param {{ commitHash?: string, gitRef?: string }} [values] 覆盖值
 * @returns {string} 替换后文本
 */
export function applyPagesPlaceholders(source, values = {}) {
	return source
		.replaceAll(FOUNT_COMMIT_HASH_PLACEHOLDER, values.commitHash ?? fountVersion)
		.replaceAll(FOUNT_GIT_REF_PLACEHOLDER, values.gitRef ?? fountGitRef)
}

/**
 * @param {string} relPath 请求相对路径
 * @returns {string[]} 候选文件路径
 */
function hookedPagesCandidates(relPath) {
	const candidates = [relPath]
	if (relPath.endsWith('/')) candidates.push(`${relPath}index.html`)
	else if (!path.posix.extname(relPath)) candidates.push(`${relPath}/index.html`)
	return candidates
}

/**
 * 读取并替换含占位符的 Pages 文件。
 * @param {string} pagesRoot `.github/pages` 绝对路径
 * @param {string} relPath 相对路径
 * @param {Record<string, string>} cache 本应用实例的文件缓存
 * @returns {Promise<{ body: string, relPath: string } | null>} 命中的文件；无占位符或读失败则为 null
 */
async function getHookedPagesFile(pagesRoot, relPath, cache) {
	for (const candidate of hookedPagesCandidates(relPath)) {
		if (cache[candidate]) return { body: cache[candidate], relPath: candidate }
		const fullPath = path.join(pagesRoot, candidate)
		let source
		try {
			source = await fs.readFile(fullPath, 'utf8')
		}
		catch {
			continue
		}
		if (!source.includes('__FOUNT_')) return null
		const body = cache[candidate] = applyPagesPlaceholders(source)
		return { body, relPath: candidate }
	}
	return null
}

/**
 * @param {string} relPath 相对 `.github/pages` 的路径
 * @returns {string} Content-Type
 */
function pagesFileContentType(relPath) {
	if (relPath.endsWith('.html')) return 'html'
	if (relPath.endsWith('.mjs') || relPath.endsWith('.js')) return 'application/javascript'
	return 'text/plain'
}

/**
 * 创建模拟 GitHub Pages 部署结构的 Express 应用（不 listen）。
 * @param {string} [projectRoot=REPO_ROOT] 仓库根
 * @returns {import('npm:express').Express} Express 应用
 */
export function createPagesApp(projectRoot = REPO_ROOT) {
	const hooked_file_cache = {}
	const app = express()

	// `cp -r ./src/public/locales ./.github/pages/`
	app.use('/fount/locales', express.static(path.join(projectRoot, 'src', 'public', 'locales')))

	// `cp -r ./imgs ./.github/pages/`
	app.use('/fount/imgs', express.static(path.join(projectRoot, 'imgs')))

	// `cp -rn ./src/public/pages/scripts ./.github/pages/`（-n：目标已有则不覆盖）
	app.use('/fount/scripts', express.static(path.join(projectRoot, '.github', 'pages', 'scripts')))
	app.use('/fount/scripts', express.static(path.join(projectRoot, 'src', 'public', 'pages', 'scripts')))

	// 测试框架浏览器侧脚本（pages/scripts 未覆盖的路径）
	app.use('/fount/scripts/test', express.static(path.join(projectRoot, 'src', 'scripts', 'test')))

	app.get('/fount/data/comments.json', async (req, res) => {
		try {
			const response = await fetch(GITHUB_PAGES_COMMENTS_URL, {
				signal: AbortSignal.timeout(8000),
			})
			if (response.ok) return res.json(await response.json())
		}
		catch { /* fall through to mock */ }
		return res.json([
			{
				name: 'test user',
				avatar: null,
				feedback: 'test feedback',
				created_at: '2026-03-07 18:45:12',
			},
			{
				name: '测试用户',
				avatar: null,
				feedback: '测试反馈',
				created_at: '2026-03-08 18:45:12',
			},
			{
				name: 'ユーザー',
				avatar: null,
				feedback: 'フィードバック',
				created_at: '2026-03-09 18:45:12',
			},
		])
	})

	const pagesRoot = path.join(projectRoot, '.github', 'pages')
	app.use('/fount', async (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()
		const relPath = path.posix.normalize(decodeURIComponent(req.path.replace(/^\//, '')))
		if (relPath.startsWith('..')) return next()
		const abs = path.resolve(pagesRoot, relPath)
		if (!abs.startsWith(path.resolve(pagesRoot))) return next()
		const hooked = await getHookedPagesFile(pagesRoot, relPath, hooked_file_cache)
		if (hooked == null) return next()
		res.type(pagesFileContentType(hooked.relPath)).send(hooked.body)
	})

	app.use('/fount', express.static(pagesRoot))
	/**
	 * 失效单个 hooked 缓存项。
	 * @param {string} filename 相对 `.github/pages` 的路径
	 * @returns {void}
	 */
	app.locals.invalidateHookedPages = filename => {
		if (!filename) return
		delete hooked_file_cache[String(filename).replaceAll('\\', '/')]
	}
	/**
	 * 清空 hooked 缓存。
	 * @returns {void}
	 */
	app.locals.invalidateAllHookedPages = () => {
		for (const key of Object.keys(hooked_file_cache))
			delete hooked_file_cache[key]
	}
	return app
}

/**
 * Pages 本地服务器句柄。
 * @typedef {object} PagesServerHandle
 * @property {import('npm:express').Express} app Express 应用
 * @property {import('node:http').Server} server HTTP server
 * @property {number} port 监听端口
 * @property {string} baseUrl 页面根 URL（含 /fount）
 * @property {() => Promise<void>} close 关闭服务器
 */

/**
 * 启动 GitHub Pages 本地静态服务器。
 * @param {object} [options] 选项
 * @param {number} [options.port=8080] 监听端口
 * @param {string} [options.projectRoot=REPO_ROOT] 仓库根
 * @param {string} [options.host='127.0.0.1'] 绑定地址
 * @returns {Promise<PagesServerHandle>} 服务器句柄
 */
export async function startPagesServer({ port = 8080, projectRoot = REPO_ROOT, host = '127.0.0.1' } = {}) {
	await refreshFountGitMeta()
	const app = createPagesApp(projectRoot)
	const pagesWatcher = watch(path.join(projectRoot, '.github', 'pages'), { recursive: true }, (_event, filename) => {
		app.locals.invalidateHookedPages(filename)
	})
	const gitWatcher = watch(path.join(projectRoot, '.git'), (_event, filename) => {
		if (String(filename || '').replaceAll('\\', '/') !== 'HEAD') return
		refreshFountGitMeta()
		app.locals.invalidateAllHookedPages()
	})
	return new Promise((resolve, reject) => {
		const server = app.listen(port, host, () => {
			resolve({
				app,
				server,
				port,
				baseUrl: `http://${host}:${port}/fount`,
				/**
				 * 关闭 HTTP server 与文件系统监视（掐断 keep-alive 后 close）。
				 * @returns {Promise<void>}
				 */
				close: () => new Promise((closeResolve, closeReject) => {
					pagesWatcher.close()
					gitWatcher.close()
					// Playwright 退出后 keep-alive 连接可能仍挂着；不强制掐断则 server.close 会一直等
					server.closeAllConnections?.()
					server.close(error => error ? closeReject(error) : closeResolve())
				}),
			})
		})
		server.on('error', reject)
	})
}
