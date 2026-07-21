/**
 * 媒体区飘心 / 点赞反馈动画。
 * @param {HTMLElement} host 宿主
 * @param {object} [options] 选项
 * @param {string} [options.emoji='👍'] 表情
 * @param {number} [options.durationMs=800] 动画毫秒
 * @param {string} [options.selector='.heart-anim'] 已有节点选择器
 * @param {boolean} [options.createIfMissing=false] 无节点时是否创建
 * @param {string} [options.createClass='heart-anim'] 新建 class
 * @param {'reuse' | 'spawn'} [options.mode='reuse'] reuse 播放已有节点；spawn 临时节点后移除
 * @returns {void}
 */
export function playHeartAnim(host, {
	emoji = '👍',
	durationMs = 800,
	selector = '.heart-anim',
	createIfMissing = false,
	createClass = 'heart-anim',
	mode = 'reuse',
} = {}) {
	if (mode === 'spawn') {
		const heart = document.createElement('div')
		heart.className = createClass
		heart.textContent = emoji
		heart.style.cssText = `position:absolute;left:50%;bottom:2rem;animation:heartFloat ${durationMs / 1000}s ease-out forwards;pointer-events:none;`
		host.appendChild(heart)
		setTimeout(() => heart.remove(), durationMs + 100)
		return
	}
	let anim = host.querySelector(selector)
	if (!(anim instanceof HTMLElement)) {
		if (!createIfMissing) return
		anim = document.createElement('div')
		anim.className = createClass
		anim.setAttribute('aria-hidden', 'true')
		host.appendChild(anim)
	}
	anim.classList.remove('hidden')
	anim.textContent = emoji
	anim.style.animation = 'none'
	void anim.offsetWidth
	anim.style.animation = `heartFloat ${durationMs / 1000}s ease-out forwards`
	setTimeout(() => anim.classList.add('hidden'), durationMs + 100)
}
