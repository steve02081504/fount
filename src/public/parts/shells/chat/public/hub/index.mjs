/**
 * 【文件】public/hub/index.mjs
 * 【职责】Chat Hub 前端入口：在加载子模块前应用主题，再串联事件绑定与初始化引导。
 * 【原理】wireBootstrap 同步尽快可用；initCore → wireEvents → init 顺序执行重型引导。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/theme、init、initCore、wireEvents、wireBootstrap
 */
import { createReadyGate } from '/scripts/test/ready_gate.mjs'
import { applyTheme } from '../../../../scripts/theme/index.mjs'

import { HUB_GATE } from './gate.mjs'
import { wireBootstrap } from './wiring/bootstrap.mjs'

const hubGate = createReadyGate(HUB_GATE)

applyTheme()
wireBootstrap()

/**
 * Hub 重型初始化：导航就绪后再绑全量事件与 WS/消息图。
 * @returns {Promise<void>}
 */
export async function bootHub() {
	hubGate.markPending()
	try {
		const { initCore } = await import('./initCore.mjs')
		await initCore()
		const { wireEvents } = await import('./wiring/index.mjs')
		wireEvents()
		const { init } = await import('./init.mjs')
		await init()
		hubGate.markReady()
	}
	catch (error) {
		hubGate.markFailed(error)
		const { handleUIError } = await import('../src/ui/errors.mjs')
		handleUIError(error, 'chat.hub.loadGroupFailed')
		throw error
	}
}

await bootHub()
