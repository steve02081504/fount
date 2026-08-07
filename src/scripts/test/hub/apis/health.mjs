/**
 * 测试 hub 健康检查：`GET /health`。
 */
import { Router } from 'npm:express'

/**
 * @returns {import('npm:express').Router} 路由
 */
export function createHealthRouter() {
	const router = Router()
	router.get('/health', (req, res) => {
		res.json({ ok: true })
	})
	return router
}
