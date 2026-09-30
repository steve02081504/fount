/** 群视图生命周期：切群、切模式或重新进入同群时递增版本，使旧异步结果失效；切频道不递增群同步版本。 */
import { store, watchState } from './state.mjs'

let version = 0
watchState('context.currentGroupId', () => { version++ })
watchState('context.currentMode', () => { version++ })
watchState('context.currentState', state => { if (!state) version++ })

/** @returns {number} 当前群视图版本 */
export function currentGroupContextVersion() {
	return version
}

/**
 * @param {string} groupId 群 ID
 * @returns {() => boolean} 本次群视图仍有效（允许群聊与私聊）
 */
export function captureGroupContext(groupId) {
	const capturedVersion = version
	return () => version === capturedVersion && store.context.currentGroupId === groupId
}
