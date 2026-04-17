import { onClickOutside } from './clickOutside.mjs'

/**
 *
 */
export const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '✅', '❌', '🤔', '👏', '🙏', '💯']

/** @type {boolean} */
let pickerModuleLoaded = false

/**
 * 与页面 data-theme / 系统偏好对齐的 emoji-picker 外观。
 * @returns {'light'|'dark'} 传给 emoji-picker 自定义元素的 class
 */
function emojiPickerSkin() {
	const t = document.documentElement.dataset.theme || ''
	if (t === 'dark') return 'dark'
	if (t === 'light') return 'light'
	return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

/**
 *
 */
async function ensurePickerModule() {
	if (!pickerModuleLoaded) {
		await import('https://esm.sh/emoji-picker-element')
		pickerModuleLoaded = true
	}
}

/**
 * 在指定位置弹出表情选择器。
 * @param {MouseEvent} anchorEvent 触发事件（用于定位）
 * @param {function(string): void} onPick 选中表情时的回调
 * @returns {Promise<void>} 在懒加载模块完成且 overlay 已插入文档后兑现
 */
export async function showEmojiPicker(anchorEvent, onPick) {
	document.getElementById('emoji-picker-popup')?.remove()

	await ensurePickerModule()

	const overlay = document.createElement('div')
	overlay.id = 'emoji-picker-popup'
	overlay.style.cssText = 'position:fixed;z-index:9999;'

	const picker = document.createElement('emoji-picker')
	picker.setAttribute('class', emojiPickerSkin())

	/** @type {(() => void) | null} */
	let outsideCleanup = null

	/**
	 *
	 */
	const detachClose = () => {
		outsideCleanup?.()
		outsideCleanup = null
	}

	/**
	 * @param {CustomEvent<{ unicode?: string }>} e emoji-picker 的 emoji-click
	 */
	const onEmojiClick = e => {
		const unicode = e.detail?.unicode
		if (unicode) onPick(unicode)
		detachClose()
		overlay.remove()
	}
	picker.addEventListener('emoji-click', onEmojiClick)

	overlay.appendChild(picker)
	document.body.appendChild(overlay)

	const pickerW = 360
	const pickerH = 420
	const { clientX, clientY } = anchorEvent
	overlay.style.left = `${Math.max(0, Math.min(clientX, window.innerWidth - pickerW))}px`
	overlay.style.top = `${Math.max(0, Math.min(clientY, window.innerHeight - pickerH))}px`

	setTimeout(() => {
		outsideCleanup = onClickOutside(overlay, () => {
			detachClose()
			overlay.remove()
		})
	}, 0)
}
