import { geti18n } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/** UI 档位选项 */
const VISIBILITY_OPTIONS = [
	{ value: 'public', i18n: 'social.composer.visibility.public' },
	{ value: 'unlisted', i18n: 'social.composer.visibility.unlisted' },
	{ value: 'followers', i18n: 'social.composer.visibility.followers' },
	{ value: 'followers_7d', i18n: 'social.composer.visibility.followers7d' },
	{ value: 'followers_30d', i18n: 'social.composer.visibility.followers30d' },
	{ value: 'selected', i18n: 'social.composer.visibility.selected' },
	{ value: 'private', i18n: 'social.composer.visibility.private' },
]

/**
 * 可见性档位图标与 i18n 键。
 * @param {string} [visibility] 档位
 * @param {number} [minFollowMs] 关注时长
 * @returns {{ code: string, icon: string, labelKey: string }} 展示信息
 */
export function visibilityDisplay(visibility, minFollowMs = 0) {
	let code = visibility || 'public'
	if (code === 'followers_since') {
		const day = 24 * 60 * 60 * 1000
		code = minFollowMs >= 30 * day ? 'followers_30d' : 'followers_7d'
	}
	const map = {
		public: { icon: 'globe', labelKey: 'social.composer.visibility.public' },
		unlisted: { icon: 'unlisted', labelKey: 'social.composer.visibility.unlisted' },
		followers: { icon: 'lock', labelKey: 'social.composer.visibility.followers' },
		followers_7d: { icon: 'lock', labelKey: 'social.composer.visibility.followers7d' },
		followers_30d: { icon: 'lock', labelKey: 'social.composer.visibility.followers30d' },
		selected: { icon: 'selected', labelKey: 'social.composer.visibility.selected' },
		private: { icon: 'private', labelKey: 'social.composer.visibility.private' },
	}
	const row = map[code] || map.public
	return { code, ...row }
}

/**
 * 从 picker DOM 读取可见性 draft。
 * @param {HTMLElement | Document} root 根节点
 * @returns {object} visibility draft
 */
export function readVisibilityPicker(root = document) {
	const select = root.querySelector('[data-visibility-select]')
	const visibility = select instanceof HTMLSelectElement ? select.value : 'public'
	/** @type {object} */
	const draft = { visibility }
	if (visibility === 'selected') {
		const allowInput = root.querySelector('[data-visibility-allow]')
		const raw = allowInput instanceof HTMLInputElement ? allowInput.value : ''
		draft.allow = raw.split(/[\s,]+/u).map(s => s.trim().toLowerCase()).filter(Boolean)
	}
	const exceptInput = root.querySelector('[data-visibility-except]')
	if (exceptInput instanceof HTMLInputElement && exceptInput.value.trim())
		draft.except = exceptInput.value.split(/[\s,]+/u).map(s => s.trim().toLowerCase()).filter(Boolean)
	return draft
}

/**
 * 渲染可见性 picker HTML。
 * @param {object} [options] 选项
 * @param {string} [options.selected='public'] 当前值（含 UI 预设）
 * @param {string} [options.allow=''] allow 列表文本
 * @param {string} [options.except=''] except 列表文本
 * @param {string} [options.idPrefix=''] id 前缀
 * @returns {string} HTML
 */
export function renderVisibilityPickerHtml(options = {}) {
	const selected = options.selected || 'public'
	const idPrefix = options.idPrefix || ''
	const optionHtml = VISIBILITY_OPTIONS.map(opt =>
		`<option value="${opt.value}"${opt.value === selected ? ' selected' : ''}>${escapeHtml(geti18n(opt.i18n))}</option>`,
	).join('')
	const showAllow = selected === 'selected' ? '' : ' hidden'
	const showExcept = ['public', 'unlisted', 'followers', 'followers_7d', 'followers_30d'].includes(selected) ? '' : ' hidden'
	return `
		<div class="visibility-picker" data-visibility-picker>
			<select data-visibility-select id="${escapeHtml(idPrefix)}Visibility" class="select select-bordered select-sm composer-select composer-visibility">
				${optionHtml}
			</select>
			<input data-visibility-allow type="text" class="input input-bordered input-sm visibility-allow${showAllow}"
				placeholder="${escapeHtml(geti18n('social.composer.visibility.allow.placeholder'))}"
				value="${escapeHtml(options.allow || '')}" />
			<input data-visibility-except type="text" class="input input-bordered input-sm visibility-except${showExcept}"
				placeholder="${escapeHtml(geti18n('social.composer.visibility.except.placeholder'))}"
				value="${escapeHtml(options.except || '')}" />
		</div>
	`
}

/**
 * 绑定 picker 交互（选 selected 时显示 allow 等）。
 * @param {HTMLElement} root picker 根或祖先
 * @returns {void}
 */
export function bindVisibilityPicker(root) {
	const picker = root.querySelector('[data-visibility-picker]') || root
	const select = picker.querySelector('[data-visibility-select]')
	if (!(select instanceof HTMLSelectElement)) return
	/**
	 * 输入框可能被 [data-visibility-field] 标签包裹（composer 高级面板），此时按整行显隐。
	 * @param {HTMLElement | null} el 输入节点
	 * @returns {HTMLElement | null} 字段容器或原节点
	 */
	const fieldOf = el => el?.closest('[data-visibility-field]') || el
	/**
	 * 按当前可见性档位同步 allow / except 显隐。
	 * @returns {void}
	 */
	const sync = () => {
		const value = select.value
		const allow = picker.querySelector('[data-visibility-allow]')
		const except = picker.querySelector('[data-visibility-except]')
		if (allow instanceof HTMLElement)
			fieldOf(allow).classList.toggle('hidden', value !== 'selected')
		if (except instanceof HTMLElement)
			fieldOf(except).classList.toggle('hidden', !['public', 'unlisted', 'followers', 'followers_7d', 'followers_30d'].includes(value))
	}
	select.addEventListener('change', sync)
	sync()
}

/**
 * 将可见性草稿写回 picker DOM。
 * @param {HTMLElement | Document} root 根节点
 * @param {object} [draft] 可见性字段
 * @returns {void}
 */
export function applyVisibilityPicker(root = document, draft = {}) {
	const select = root.querySelector('[data-visibility-select]')
	if (!(select instanceof HTMLSelectElement)) return
	let value = String(draft.visibility || 'public')
	if (value === 'followers_since') {
		const day = 24 * 60 * 60 * 1000
		const ms = Number(draft.minFollowMs) || 0
		value = ms >= 30 * day ? 'followers_30d' : 'followers_7d'
	}
	const known = new Set(VISIBILITY_OPTIONS.map(opt => opt.value))
	select.value = known.has(value) ? value : 'public'
	const allow = root.querySelector('[data-visibility-allow]')
	if (allow instanceof HTMLInputElement)
		allow.value = Array.isArray(draft.allow) ? draft.allow.join(' ') : ''
	const except = root.querySelector('[data-visibility-except]')
	if (except instanceof HTMLInputElement)
		except.value = Array.isArray(draft.except) ? draft.except.join(' ') : ''
	select.dispatchEvent(new Event('change', { bubbles: true }))
}
