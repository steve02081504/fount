/**
 * 共享微交互助手：关键帧重播、数字弹跳、图标切换、粒子。
 * 配套 CSS（`.motion-*`、时长 Token、reduced-motion 守卫）在 motion/styles.css，
 * 由 base.css 全局引入；模式说明见 pages/docs/design-system/motion-patterns.md。
 */

/**
 * 当前是否偏好减少动态效果。
 * @returns {boolean} 为 true 时应跳过动效
 */
export function prefersReducedMotion() {
	return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

/**
 * 播放一次性关键帧动画：移除后重排再添加，保证可重播。
 * @param {HTMLElement} element 目标元素
 * @param {string} className 播放期间添加的类名
 * @param {number} durationMs 动画时长，用于移除类名
 * @returns {void}
 */
export function replayAnimation(element, className, durationMs) {
	element.classList.remove(className)
	void element.offsetWidth
	element.classList.add(className)
	clearTimeout(element.motionTimer)
	element.motionTimer = setTimeout(() => element.classList.remove(className), durationMs)
}

/**
 * 数字变化弹跳（点赞数、通知数等）。
 * @param {HTMLElement} element 承载数字的元素
 * @returns {void}
 */
export function popNumber(element) {
	if (!prefersReducedMotion()) replayAnimation(element, 'motion-pop', 360)
}

/**
 * 同一槽位图标切换（outline ↔ filled 等）的淡入缩放。
 * @param {HTMLElement} element 图标元素
 * @returns {void}
 */
export function swapIcon(element) {
	if (!prefersReducedMotion()) replayAnimation(element, 'motion-swap', 240)
}

/**
 * 在宿主上生成短时粒子。调用方传入图标类；默认是主题化的圆点，禁止 emoji。
 * @param {HTMLElement} host 宿主（需为定位上下文）
 * @param {{ glyphClass?: string, count?: number, durationMs?: number }} [options] 选项
 * @returns {void}
 */
export function burst(host, { glyphClass = 'motion-dot', count = 1, durationMs = 800 } = {}) {
	if (prefersReducedMotion()) return
	for (let index = 0; index < count; index++) {
		const particle = document.createElement('span')
		particle.className = `${glyphClass} motion-particle`
		particle.setAttribute('aria-hidden', 'true')
		particle.style.left = `${50 + (index - (count - 1) / 2) * 18}%`
		particle.style.animationDelay = `${index * 90}ms`
		host.appendChild(particle)
		setTimeout(() => particle.remove(), durationMs + index * 90 + 100)
	}
}
