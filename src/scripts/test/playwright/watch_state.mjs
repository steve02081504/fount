/**
 * page watch drain 诊断文案：drain 超时时指出卡在哪个任务，纯函数便于 selftest。
 */

/**
 * 把一个任务的快照格式化为 `name(…)`。
 * @param {{ name: string, covered: boolean, idle: boolean, lastRunMs: number | null }} task 任务快照
 * @returns {string} 描述
 */
function describeTask(task) {
	const marks = [task.covered ? 'covered' : 'UNCOVERED']
	if (task.idle) marks.push('idle')
	else if (task.lastRunMs != null) marks.push(`last ${task.lastRunMs}ms`)
	return `${task.name}(${marks.join(' ')})`
}

/**
 * 描述 watch 状态。未知形态（老页面 / 未挂载 / 主线程被阻塞到取不到）返回空串，调用方按无信息处理。
 * @param {object | null | undefined} watchState `fount.test.watch.state()` 的返回值
 * @returns {string} 描述；无信息时为空串
 */
export function describeWatchState(watchState) {
	if (!watchState || !Array.isArray(watchState.tasks)) return ''
	const head = [
		watchState.draining ? 'draining' : 'not-draining',
		watchState.running ? `running ${watchState.running}${watchState.elapsedMs == null ? '' : ` ${watchState.elapsedMs}ms`}` : 'not-running',
		watchState.scheduled ? 'timer-armed' : 'parked',
		`idleStreak ${watchState.idleStreak ?? '?'}`,
	].join(' · ')
	return `${head} · ${watchState.tasks.map(describeTask).join(', ')}`
}
