/** 固定高度的可见区队列，树和差异视图只挂载窗口内的行。 */
/**
 * @param {HTMLElement} host - Scroll container.
 * @param {{height?: number, render: Function}} options - Row geometry and renderer.
 * @returns {{set: Function, refresh: Function, destroy: Function}} Window controller.
 */
export function windowedRows(host, { height = 28, render }) {
	let rows = [], frame = 0, first = -1, last = -1
	const top = document.createElement('div'), body = document.createElement('div'), bottom = document.createElement('div')
	top.setAttribute('aria-hidden', 'true'); bottom.setAttribute('aria-hidden', 'true')
	host.replaceChildren(top, body, bottom)
	/** @returns {void} 绘制带有限预留行的可视窗口。 */
	function paint() {
		frame = 0
		const start = Math.max(0, Math.min(rows.length, Math.floor(host.scrollTop / height) - 12))
		const end = Math.min(rows.length, start + Math.ceil(host.clientHeight / height) + 24)
		if (start === first && end === last) return
		first = start; last = end
		top.style.height = `${start * height}px`
		bottom.style.height = `${(rows.length - end) * height}px`
		body.replaceChildren(...rows.slice(start, end).map((row, index) => {
			const element = render(row, start + index)
			element.style.height = `${height}px`
			element.style.boxSizing = 'border-box'
			return element
		}))
	}
	/** @returns {void} 合并滚动和尺寸变化触发的绘制任务。 */
	function schedule() { if (!frame) frame = requestAnimationFrame(paint) }
	host.addEventListener('scroll', schedule, { passive: true })
	const observer = new ResizeObserver(schedule)
	observer.observe(host)
	return {
		/** @param {Array<object>} next - Flattened rows. */
		set(next) { rows = next; first = last = -1; paint() },
		/** @returns {void} 重新测量并绘制当前可视行。 */
		refresh() { first = last = -1; schedule() },
		/** @returns {void} 移除监听器并释放可视窗口资源。 */
		destroy() { cancelAnimationFrame(frame); observer.disconnect(); host.removeEventListener('scroll', schedule) },
	}
}
