/**
 * 测试 hub 健康检查：`GET /health`。
 */
import { Router } from 'npm:express'

/** 测试内核 `/health` JSON 上的专用标识。 */
export const TEST_KERNEL_HEALTH_ID = 'fount-test-kernel'

/**
 * @param {object} [options] 选项
 * @param {boolean} [options.kernel] 是否为测试内核（带专用标识）
 * @returns {import('npm:express').Router} 路由
 */
export function createHealthRouter({ kernel = false } = {}) {
	const router = Router()
	router.get('/health', (req, res) => {
		res.json(kernel ? { ok: true, kernel: TEST_KERNEL_HEALTH_ID } : { ok: true })
	})
	return router
}
