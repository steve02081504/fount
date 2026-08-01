/**
 * `GET /health`
 */
import { Router } from 'npm:express'

/**
 * @returns {import('npm:express').Router} 路由
 */
export function createHealthRouter() {
	const router = Router()
	router.get('/health', (_req, res) => {
		res.json({ ok: true })
	})
	return router
}
