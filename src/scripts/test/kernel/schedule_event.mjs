/**
 * 把理想调度投影包装成发给消费端的 `schedule-update` 事件。
 */

/**
 * schedule-update 原因枚举。
 * @typedef {string} ScheduleChangeReason
 */

/**
 * @param {object} projection 消费端投影
 * @param {import('./schedule.mjs').ScheduleSlot[]} projection.running 在跑项
 * @param {number | null} projection.lastCompletionAt 本队列最后一个任务完成时刻
 * @param {number} projection.unknownCount 未知耗时项数
 * @param {object} viewer viewer
 * @param {boolean} viewer.watch 是否 watch
 * @param {string | null} viewer.jobId 归属 job
 * @param {ScheduleChangeReason} reason 变化原因
 * @param {string} [reasonDetail] 原因细节
 * @returns {object} schedule-update 事件
 */
export function buildScheduleUpdate(projection, viewer, reason, reasonDetail = '') {
	const now = Date.now()
	return {
		type: 'schedule-update',
		watch: viewer.watch,
		jobId: viewer.jobId,
		running: projection.running.map(slot => ({
			key: slot.key,
			startedAt: new Date(now + slot.startAt).toISOString(),
			remainingMs: slot.endAt == null ? null : Math.max(0, slot.endAt - slot.startAt),
			waiting: slot.running,
		})),
		lastCompletionAt: projection.lastCompletionAt == null
			? null
			: new Date(now + projection.lastCompletionAt).toISOString(),
		lastCompletionMs: projection.lastCompletionAt,
		unknownCount: projection.unknownCount,
		reason,
		reasonDetail,
	}
}

/**
 * @param {ScheduleChangeReason} reason 原因
 * @returns {string} 可读原因标签
 */
export function formatScheduleReason(reason) {
	switch (reason) {
		case 'initial': return '计划就绪'
		case 'suite_started': return '开始运行'
		case 'suite_completed': return '套件完成'
		case 'suite_failed': return '套件失败'
		case 'blocked': return '依赖失败，阻塞'
		case 'skipped': return '依赖跳过'
		case 'queue_appended': return '新任务入队'
		case 'queue_removed': return '任务取消'
		case 'prep_promoted': return '预备晋升'
		case 'dependency_ready': return '依赖就绪'
		case 'resource_budget_changed': return '资源预算变化'
		case 'job_queued': return '新任务排队'
		default: return reason || '进度更新'
	}
}

/**
 * 消费端是否应展示本次变化：与上次展示时刻相差 ≥5%。
 * @param {number | null | undefined} lastDisplayedAt 上次展示的 lastCompletionAt
 * @param {number | null} nextAt 本次 lastCompletionAt
 * @param {number} [deltaThresholdPct=5] 百分比阈值
 * @returns {boolean} 是否展示
 */
export function shouldDisplayScheduleChange(lastDisplayedAt, nextAt, deltaThresholdPct = 5) {
	if (nextAt == null) return true
	if (lastDisplayedAt == null) return true
	const delta = Math.abs(nextAt - lastDisplayedAt)
	return delta / Math.max(1, lastDisplayedAt) > deltaThresholdPct / 100
}
