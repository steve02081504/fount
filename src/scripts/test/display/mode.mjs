/**
 * 测试显示模式：按调用形态而不是本波真跑数。
 */

/**
 * @param {object} params 参数
 * @param {boolean} [params.watch] watch 挂起
 * @param {object} [params.job] 提交的 job
 * @param {number} [params.runCount] 真跑套件数
 * @returns {'stream' | 'multi' | 'overview'} 显示模式
 */
export function resolveDisplayMode({ watch = false, job, runCount = 0 } = {}) {
	if (watch || !job) return 'overview'
	if (!job.runAll && !job.groups?.length) return 'overview'
	if (runCount === 1) return 'stream'
	if (runCount > 1) return 'multi'
	return 'overview'
}

/**
 * 显示层是否该结束：指名 job 看 job-done；裸总览等 idle（双队列空），空波次仍跟 job-done。
 * @param {object} msg 内核事件
 * @param {object} state 当前显示状态
 * @param {boolean} [state.watch] watch 挂起
 * @param {'stream' | 'multi' | 'overview'} state.displayMode 模式
 * @param {object} [state.job] 提交的 job
 * @param {number} [state.runCount] 真跑套件数
 * @returns {boolean} 是否 resolve
 */
export function displayShouldResolve(msg, { watch, displayMode, job, runCount = 0 }) {
	if (watch) return false
	if (msg.type === 'idle') return displayMode === 'overview'
	if (msg.type !== 'job-done' || !job) return false
	if (displayMode !== 'overview') return true
	return !runCount
}
