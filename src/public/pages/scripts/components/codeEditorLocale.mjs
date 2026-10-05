import { main_locale, offLanguageChange, onLanguageChange } from '../i18n/index.mjs'

const packs = new Map(), labels = new Map()
let packQueue = Promise.resolve(), activeMessages = [], englishMessages = []

/**
 * @param {string} locale - 已解析的 fount 界面语言。
 * @returns {string} 可用的 Monaco 消息包名。
 */
function editorLanguage(locale) {
	const name = locale.toLowerCase()
	if (name.startsWith('zh')) return /tw|hk|hant/.test(name) ? 'zh-tw' : 'zh-cn'
	return ['de', 'es', 'fr', 'it', 'ja', 'ko', 'ru', 'tr', 'pl', 'cs', 'pt-br'].find(code => name === code || name.startsWith(code + '-')) || 'en'
}

/**
 * 串行化带副作用的消息导入，并保留每个语言包供语言轮换使用。
 * @param {string} language - Monaco 语言名。
 * @returns {Promise<string[]>} 按 Monaco 数字顺序排列的消息。
 */
function loadPack(language) {
	if (!packs.has(language)) {
		const pending = packQueue.then(async () => {
			await import(`https://esm.sh/monaco-editor@0.55.1/esm/nls.messages${language === 'en' ? '' : '.' + language}.js`)
			const messages = globalThis._VSCODE_NLS_MESSAGES
			globalThis._VSCODE_NLS_MESSAGES = activeMessages
			return messages
		}).catch(error => { packs.delete(language); throw error })
		packs.set(language, pending)
		packQueue = pending.catch(() => {})
	}
	return packs.get(language)
}

/**
 * 取实际生效的 fount 语言，而不是没匹配上的偏好语言。
 * @returns {Promise<void>} 动态 Monaco 消息与标签查找已更新。
 */
export async function syncEditorLocale() {
	const language = editorLanguage(main_locale)
	englishMessages = await loadPack('en')
	const messages = await loadPack(language)
	if (language !== editorLanguage(main_locale)) return syncEditorLocale()
	activeMessages = messages
	globalThis._VSCODE_NLS_MESSAGES = messages
	globalThis._VSCODE_NLS_LANGUAGE = language
	for (let index = 0; index < englishMessages.length; index++) {
		labels.set(englishMessages[index], index)
		if (!labels.has(messages[index])) labels.set(messages[index], index)
	}
}

/**
 * @param {string} original - 原生文案，可能带快捷键后缀。
 * @returns {string} 当前语言的消息或原文。
 */
function translateLabel(original) {
	const index = labels.get(original)
	if (index !== undefined) return activeMessages[index] || original
	const match = original.match(/^(.*?)(\s+\([^)]*\))$/)
	if (match && labels.has(match[1])) return translateLabel(match[1]) + match[2].replace(/\((.*)\)/, (_whole, hint) => '(' + translateLabel(hint) + ')')
	return original
}

/**
 * 就地本地化已缓存的原生控件，不替换编辑器模型或撤销历史。
 * @param {object} view - Monaco 编辑器实例。
 * @param {HTMLElement} host - 编辑器挂载点。
 * @returns {Promise<() => void>} 监听器与 observer 的释放函数。
 */
export async function bindEditorLocale(view, host) {
	const roots = new Set([host]), originals = new WeakMap()
	const options = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] }
	let disposed = false
	const observer = new MutationObserver(translateChrome)
	observer.observe(host, options)

	/**
	 * 只更新已知的原生消息，并在切换语言时保留其原文。
	 * @param {Node} node - 控件或文本节点。
	 * @param {string} field - 属性名或 textContent。
	 * @param {string} current - 当前渲染出的文本。
	 * @returns {void}
	 */
	function update(node, field, current) {
		if (!current) return
		let fields = originals.get(node)
		if (!fields) { fields = new Map(); originals.set(node, fields) }
		let entry = fields.get(field)
		if (!entry || entry.rendered !== current) entry = { source: current, rendered: current }
		const next = translateLabel(entry.source)
		entry.rendered = next
		fields.set(field, entry)
		if (next === current) return
		if (field === 'textContent') node.textContent = next
		else node.setAttribute(field, next)
	}

	/** @returns {void} 翻译查找/替换控件、菜单与原生悬停文案。 */
	function translateChrome() {
		if (disposed) return
		for (const node of host.querySelectorAll('.shadow-root-host')) if (node.shadowRoot && !roots.has(node.shadowRoot)) {
			roots.add(node.shadowRoot)
			observer.observe(node.shadowRoot, options)
		}
		for (const root of roots) for (const widget of root.querySelectorAll('.find-widget, .monaco-menu, .monaco-hover, .quick-input-widget')) {
			const count = widget.querySelector('.matchesCount')
			const numbers = count?.textContent.match(/\d[\d,+]*/g)
			if (numbers?.length === 2) {
				const template = activeMessages[labels.get('{0} of {1}')]
				const text = template?.replace(/\{(\d)\}/g, (_match, index) => numbers[index])
				if (text && count.textContent !== text) count.textContent = text
			}
			for (const node of [widget, ...widget.querySelectorAll('[aria-label], [title], [placeholder]')])
				for (const field of ['aria-label', 'title', 'placeholder']) update(node, field, node.getAttribute(field))
			const walker = document.createTreeWalker(widget, NodeFilter.SHOW_TEXT)
			while (walker.nextNode()) {
				const node = walker.currentNode
				if (!node.parentElement?.closest('pre, code, textarea, input, .mirror, .monaco-tokenized-source')) update(node, 'textContent', node.textContent)
			}
		}
	}

	/** @returns {Promise<void>} 把新语言应用到实时消息与已缓存的原生标签。 */
	async function refresh() {
		await syncEditorLocale()
		if (disposed) return
		for (const action of view.getSupportedActions()) if (!action.id.startsWith('fount.')) action.label = translateLabel(action.alias || action.label)
		translateChrome()
	}
	await onLanguageChange(refresh)
	return () => { disposed = true; offLanguageChange(refresh); observer.disconnect() }
}
