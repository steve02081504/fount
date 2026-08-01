/**
 * fount test 进程内共享 hub（Express）：固定 `127.0.0.1:8903`。
 * 父进程 `runTests` 启动；各 API 见 `hub/apis/`。
 */
import express from 'npm:express'

import { createGithubIssueRouter } from './apis/github_issue.mjs'
import { createHealthRouter } from './apis/health.mjs'
import { createSharedStoreRouter } from './apis/shared_store.mjs'

/** 测试 hub 固定端口（避开生产 8931 / live 测试口）。 */
export const TEST_HUB_PORT = 8903

/**
 * @param {number} [port=TEST_HUB_PORT] 端口
 * @returns {string} hub base URL（无尾斜杠）
 */
export function testHubUrl(port = TEST_HUB_PORT) {
	return `http://127.0.0.1:${port}`
}

/** 默认 base URL（无尾斜杠）。 */
export const TEST_HUB_DEFAULT_URL = testHubUrl()

/**
 * 启动测试 hub（仅 `127.0.0.1`）。
 * @param {object} [options] 选项
 * @param {number} [options.port=TEST_HUB_PORT] 端口
 * @returns {Promise<{ url: string, close: () => Promise<void> }>} hub 句柄
 */
export async function startTestHub({ port = TEST_HUB_PORT } = {}) {
	const app = express()
	app.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		if (req.method === 'OPTIONS') return res.sendStatus(204)
		next()
	})
	app.use(express.json({ limit: '4mb' }))
	app.use(createHealthRouter())
	app.use(createGithubIssueRouter())
	app.use(createSharedStoreRouter())
	app.use((req, res) => {
		res.status(404).json({ error: 'not found' })
	})

	const server = await new Promise((resolve, reject) => {
		const httpServer = app.listen(port, '127.0.0.1', () => resolve(httpServer))
		httpServer.once('error', reject)
	})

	return {
		url: testHubUrl(port),
		/**
		 * @returns {Promise<void>}
		 */
		close: () => new Promise((resolve, reject) => {
			server.close(err => err ? reject(err) : resolve())
		}),
	}
}
