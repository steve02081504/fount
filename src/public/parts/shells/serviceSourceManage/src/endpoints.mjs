import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { getServiceSourceFile, saveServiceSourceFile, addServiceSourceFile, deleteServiceSourceFile, getConfigTemplate, getConfigDisplay } from './manager.mjs'

/**
 * 根据类型推断服务源路径。
 * @param {string} type - 服务源类型。
 * @returns {string} - 推断的服务源路径。
 */
function inferServiceSourcePath(type = 'AI') {
	return `serviceSources/${type}`
}

/**
 * 为服务源管理设置API端点，使用 RESTful 风格。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	// 列出指定类型的所有服务源
	router.get('/api/parts/shells\\:serviceSourceManage/:type', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI' } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const { getPartList } = await import('../../../../../server/parts_loader.mjs')
		const list = await getPartList(username, serviceSourcePath)
		res.status(200).json(list)
	})

	// 获取特定服务源的配置
	router.get('/api/parts/shells\\:serviceSourceManage/:type/:name', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const data = await getServiceSourceFile(username, name, serviceSourcePath)
		res.status(200).json(data)
	})

	// 创建或更新服务源
	router.post('/api/parts/shells\\:serviceSourceManage/:type/:name', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const { generator, config } = req.body

		// 检查服务源是否存在
		const existing = await getServiceSourceFile(username, name, serviceSourcePath).catch(() => null)

		if (existing && (existing.generator || existing.config)) {
			// 更新现有服务源
			const data = {
				...existing,
				config: config ? { ...existing.config, ...config } : existing.config
			}
			if (generator) data.generator = generator
			await saveServiceSourceFile(username, name, data, serviceSourcePath)
			res.status(200).json({ message: 'Service source updated successfully' })
		}
		else {
			// 创建新服务源
			await addServiceSourceFile(username, name, serviceSourcePath)
			if (generator || config) {
				const data = await getServiceSourceFile(username, name, serviceSourcePath)
				if (generator) data.generator = generator
				if (config) data.config = { ...data.config, ...config }
				await saveServiceSourceFile(username, name, data, serviceSourcePath)
			}
			res.status(201).json({ message: 'Service source created successfully' })
		}
	})

	// 删除服务源
	router.delete('/api/parts/shells\\:serviceSourceManage/:type/:name', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		await deleteServiceSourceFile(username, name, serviceSourcePath)
		res.status(200).json({ message: 'Service source deleted successfully' })
	})

	// 设置默认服务源
	router.put('/api/parts/shells\\:serviceSourceManage/:type/:name/default', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const { setDefaultPart } = await import('../../../../../server/parts_loader.mjs')
		await setDefaultPart(username, serviceSourcePath, name)
		const { unlockAchievement } = await import('../../achievements/src/api.mjs')
		unlockAchievement(username, 'shells/serviceSourceManage', 'set_default_aisource')
		res.status(200).json({ message: 'Service source set as default successfully' })
	})

	// 从生成器获取配置模板（不需要服务源名称）
	router.get('/api/parts/shells\\:serviceSourceManage/:type/generators/:generator/template', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', generator } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const template = await getConfigTemplate(username, generator, serviceSourcePath)
		res.status(200).json(template)
	})

	// 从生成器获取配置显示（不需要服务源名称）
	router.get('/api/parts/shells\\:serviceSourceManage/:type/generators/:generator/display', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', generator } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		const content = await getConfigDisplay(username, generator, serviceSourcePath)
		res.status(200).json(content)
	})

	// 从服务源获取配置模板（如果服务源存在，使用其配置）
	router.get('/api/parts/shells\\:serviceSourceManage/:type/:name/template', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		let generator = req.query.generator

		// 尝试从服务源获取信息
		try {
			const data = await getServiceSourceFile(username, name, serviceSourcePath)
			generator = generator || data?.generator
		}
		catch {
			// 如果服务源不存在，继续使用查询参数
		}

		if (!generator) {
			res.status(400).json({ error: 'Generator not specified' })
			return
		}
		const template = await getConfigTemplate(username, generator, serviceSourcePath)
		res.status(200).json(template)
	})

	// 从服务源获取配置显示（如果服务源存在，使用其配置）
	router.get('/api/parts/shells\\:serviceSourceManage/:type/:name/display', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { type = 'AI', name } = req.params
		const serviceSourcePath = inferServiceSourcePath(type)
		let generator = req.query.generator

		// 尝试从服务源获取信息
		try {
			const data = await getServiceSourceFile(username, name, serviceSourcePath)
			generator = generator || data?.generator
		}
		catch {
			// 如果服务源不存在，继续使用查询参数
		}

		if (!generator) {
			res.status(200).json({ html: '', js: '' })
			return
		}
		const content = await getConfigDisplay(username, generator, serviceSourcePath)
		res.status(200).json(content)
	})
}
