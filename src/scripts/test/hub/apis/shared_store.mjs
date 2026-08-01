/**
 * `GET|PUT|DELETE /shared-store/:namespace/:key` — 本次 hub 生命周期内前后端共享 KV。
 */
import { Router } from 'npm:express'

/**
 * @returns {import('npm:express').Router} 路由
 */
export function createSharedStoreRouter() {
	/** @type {Map<string, unknown>} `${namespace}\\0${key}` → JSON 值 */
	const store = new Map()
	const router = Router()

	/**
	 * @param {string} namespace 分区
	 * @param {string} key 键
	 * @returns {string} Map 键
	 */
	const storeKey = (namespace, key) => `${namespace}\0${key}`

	router.get('/shared-store/:namespace/:key', (req, res) => {
		const key = storeKey(req.params.namespace, req.params.key)
		if (!store.has(key))
			return res.status(404).json({ error: 'missing' })
		res.json(store.get(key))
	})

	router.put('/shared-store/:namespace/:key', (req, res) => {
		store.set(storeKey(req.params.namespace, req.params.key), req.body)
		res.sendStatus(204)
	})

	router.delete('/shared-store/:namespace/:key', (req, res) => {
		store.delete(storeKey(req.params.namespace, req.params.key))
		res.sendStatus(204)
	})

	return router
}
