/**
 * GitHub Pages 本地静态服务器（与 `.esh/commands/pages-server.mjs` 同规则）。
 * 从原始路径挂载，无需复制/构建；部署流程见 `.github/workflows/pages.yaml`。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import express from 'npm:express'

import { git } from '../../../scripts/git.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

const GITHUB_PAGES_COMMENTS_URL = 'https://steve02081504.github.io/fount/data/comments.json'
const FOUNT_COMMIT_HASH_PLACEHOLDER = '__FOUNT_COMMIT_HASH__'

let fountVersion = 'unknown'
/**
 * 解析 Pages Sentry release 占位符（与 CI sed 对齐）。
 * @returns {Promise<string>} commit hash 或 unknown
 */
async function refreshFountVersion() {
	fountVersion = await git.withPath(REPO_ROOT)('rev-parse', 'HEAD') || 'unknown'
}

const hooked_version_files = [
	'base.mjs',
]
const hooked_version_file_cache = {}
/**
 * 读取 Pages base.mjs 并替换 commit hash 占位符。
 * @param {string} filePath `.github/pages/` 下的相对路径
 * @returns {Promise<string>} 替换后的模块源码
 */
async function getHookedVersionFileContent(filePath) {
	if (hooked_version_file_cache[filePath]) return hooked_version_file_cache[filePath]
	const fullPath = path.join(REPO_ROOT, '.github', 'pages', filePath)
	const source = await fs.readFile(fullPath, 'utf8')
	return hooked_version_file_cache[filePath] = source.replaceAll(FOUNT_COMMIT_HASH_PLACEHOLDER, fountVersion)
}

fs.watch(REPO_ROOT, (event, filename) => {
	if (event === 'change' && filename.startsWith('.github/pages/')) {
		const filePath = filename.slice('.github/pages/'.length)
		if (hooked_version_files.includes(filePath))
			delete hooked_version_file_cache[filePath]
	}
	// git commit
	if (event === 'change' && filename === '.git/HEAD') {
		refreshFountVersion()
		for (const filePath of hooked_version_files)
			delete hooked_version_file_cache[filePath]
	}
})

/**
 * 创建模拟 GitHub Pages 部署结构的 Express 应用（不 listen）。
 * @param {string} [projectRoot=REPO_ROOT] 仓库根
 * @returns {import('npm:express').Express} Express 应用
 */
export function createPagesApp(projectRoot = REPO_ROOT) {
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

	for (const filePath of hooked_version_files)
		app.get(`/fount/${filePath}`, async (req, res) => {
			const body = await getHookedVersionFileContent(filePath)
			res.type('application/javascript').send(body)
		})

	app.use('/fount', express.static(path.join(projectRoot, '.github', 'pages')))
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
export function startPagesServer({ port = 8080, projectRoot = REPO_ROOT, host = '127.0.0.1' } = {}) {
	const app = createPagesApp(projectRoot)
	return new Promise((resolve, reject) => {
		const server = app.listen(port, host, () => {
			resolve({
				app,
				server,
				port,
				baseUrl: `http://${host}:${port}/fount`,
				/**
				 * 关闭 HTTP server（掐断 keep-alive 后 close）。
				 * @returns {Promise<void>}
				 */
				close: () => new Promise((closeResolve, closeReject) => {
					// Playwright 退出后 keep-alive 连接可能仍挂着；不强制掐断则 server.close 会一直等
					server.closeAllConnections?.()
					server.close(error => error ? closeReject(error) : closeResolve())
				}),
			})
		})
		server.on('error', reject)
	})
}
