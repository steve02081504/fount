/**
 * View Transition 在并发、状态变化或更新回调耗时过长时会抛出的可预期异常。
 * - AbortError: 过渡被并发的过渡或 skipTransition 中止。
 * - InvalidStateError: 文档隐藏等导致状态非法。
 * - TimeoutError: update 回调超过浏览器内置超时（Chrome 约 4s），动画被放弃但 DOM 更新仍会执行。
 * @param {Error} err 异常。
 * @returns {boolean} 是否为可预期的异常。
 */
function isExpectedViewTransitionError(err) {
	return ['AbortError', 'InvalidStateError', 'TimeoutError'].includes(err?.name)
}

/**
 * 使用 View Transition API 执行过渡。
 * @param {() => Promise<void>} update - 更新函数。
 * @param {object} options - 选项。
 * @param {boolean} options.force - 是否强制执行过渡而不考虑浏览器偏好。
 * @returns {Promise<void>} 过渡完成后的回调。
 */
export async function viewTransition(update, options) {
	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (!document.startViewTransition) return await update()
	if (prefersReducedMotion && !options?.force) return await update()
	delete options?.force
	try {
		let transition
		try {
			transition = document.startViewTransition({ update, ...options })
		} catch (err) {
			await update()
			throw err
		}
		await transition.finished
	} catch (err) {
		if (!isExpectedViewTransitionError(err)) throw err
	}
}
