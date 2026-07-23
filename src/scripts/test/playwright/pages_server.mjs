/**
 * GitHub Pages 本地静态服务器（与 `.esh/commands/pages-server.mjs` 同规则）。
 * 从原始路径挂载，无需复制/构建；部署流程见 `.github/workflows/pages.yaml`。
 */
import path from 'node:path'

import express from 'npm:express'

import { REPO_ROOT } from '../core/repo_root.mjs'

const GITHUB_PAGES_COMMENTS_URL = 'https://steve02081504.github.io/fount/data/comments.json'

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

	app.get('/fount/data/comments.json', async (_req, res) => {
		const response = await fetch(GITHUB_PAGES_COMMENTS_URL).catch(() => null)
		if (response?.ok) {
			const data = await response.json()
			return res.json(data)
		}
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

	app.use('/fount', express.static(path.join(projectRoot, '.github', 'pages')))
	return app
}

/**
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
				 * @returns {Promise<void>}
				 */
				close: () => new Promise((closeResolve, closeReject) => {
					server.close(error => error ? closeReject(error) : closeResolve())
				}),
			})
		})
		server.on('error', reject)
	})
}
