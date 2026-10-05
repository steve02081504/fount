import { onLanguageChange } from '../i18n/index.mjs'
import { onThemeChange } from '../theme/index.mjs'

import { syncEditorLocale } from './codeEditorLocale.mjs'
import { CODE_SYNTAX_CSS } from './codeSyntaxStyles.mjs'

/** 文件编辑器与 Markdown 围栏共用的增量语法、高亮与折叠规则。 */
let runtimePromise

/** @returns {Promise<object>} 带 Shiki 分词与折叠能力的共享 Monaco 运行时。 */
export function loadCodeRuntime() {
	return runtimePromise ||= syncEditorLocale().then(() => Promise.all([
		import('https://esm.sh/modern-monaco@0.4.2/editor-core'),
		import('https://esm.sh/@shikijs/monaco'),
		loadCodeHighlighter(),
		import('https://esm.sh/monaco-editor-core@0.55.1/esm/vs/editor/contrib/folding/browser/indentRangeProvider.js'),
	])).then(([monaco, integration, highlighter, folding]) => {
		foldingEngine = folding
		onLanguageChange(async () => {
			await syncEditorLocale()
			// 上一个语言留下的播报已经过期。
			for (const node of document.querySelectorAll('.monaco-aria-container .monaco-alert, .monaco-aria-container .monaco-status')) node.textContent = ''
		})
		const css = document.createElement('style')
		css.textContent = monaco.cssBundle
		document.head.appendChild(css)
		globalThis.MonacoEnvironment = {
			/** @returns {Worker} 支持跨源的编辑器 worker。 */
			getWorker: () => monaco.createEditorWorkerMain(),
		}
		/**
		 * @param {string} _theme - 应用主题名。
		 * @param {boolean} dark - 当前是否暗色。
		 * @returns {void} 同步编辑器原生配色。
		 */
		onThemeChange((_theme, dark) => {
			const name = activeTheme = CODE_THEMES[dark ? 'dark' : 'light']
			const theme = integration.textmateThemeToMonacoTheme(highlighter.getTheme(name))
			const colors = {
				'editor.background': 'base-100', 'editor.foreground': 'base-content',
				'editorGutter.background': 'base-200', 'editorLineNumber.foreground': 'base-content',
				'editorCursor.foreground': 'base-content', 'editorWidget.background': 'base-200',
				'input.background': 'base-100', 'input.foreground': 'base-content',
				focusBorder: 'primary', 'editor.foldBackground': 'base-200',
				'editorGutter.foldingControlForeground': 'base-content',
			}
			for (const [key, token] of Object.entries(colors)) theme.colors[key] = themeColor(token)
			// Monaco 会把颜色按大小写归一后去重，而 TextMate 的索引未必一致。
			const tokenColors = [], ids = new Map()
			colorRemap = Array.from(highlighter.setTheme(name).colorMap, (color, index) => {
				if (!index) return 0
				const normalized = color.replace(/^#([a-f\d]{3,4})$/i, (_match, hex) => '#' + [...hex].map(digit => digit + digit).join('')).slice(0, 7).toUpperCase()
				if (!ids.has(normalized)) { tokenColors.push(normalized); ids.set(normalized, tokenColors.length) }
				return ids.get(normalized)
			})
			theme.encodedTokensColors = tokenColors
			monaco.editor.defineTheme(name, theme)
			monaco.editor.setTheme(name)
			for (const lang of loadedEditorLanguages) installTokenizer(monaco, highlighter, lang)
		})
		return monaco
	}).catch(error => { runtimePromise = null; throw error })
}

const customLanguages = new Map()
const languageConfigs = new Map(), loadedEditorLanguages = new Set()
const tokenProviders = new Map()
let activeTheme = 'github-light', colorRemap = [], foldingEngine

/**
 * @param {object} monaco - 共享运行时。
 * @param {string} lang - 规范语言 ID。
 * @returns {object} 惰性转换的语言配置。
 */
function languageConfig(monaco, lang) {
	if (!languageConfigs.has(lang)) {
		const raw = monaco.languageConfigurations[monaco.languageConfigurationAliases[lang] || lang]
		languageConfigs.set(lang, raw ? monaco.convertVscodeLanguageConfiguration(structuredClone(raw)) : {})
	}
	return languageConfigs.get(lang)
}

/** 在 Monaco 的逐行增量分词之间保留的不可变 TextMate 状态。 */
class TokenizerState {
	/** @param {object|null} [stack=null] - TextMate 语法栈。 */
	constructor(stack = null) { this.stack = stack }
	/** @returns {TokenizerState} 不可变状态。 */
	clone() { return this }
	/**
	 * @param {TokenizerState} other - 前一行状态。
	 * @returns {boolean} 后续行能否复用其分词结果。
	 */
	equals(other) { return !!other && (this.stack === other.stack || !!this.stack?.equals(other.stack)) }
}

/**
 * 直接把 TextMate 的编码颜色交给 Monaco：重建 scope 会在多个 scope 共用同一颜色
 * 或主题切换时丢色。
 * @param {object} monaco - 编辑器命名空间。
 * @param {object} highlighter - 共享 Shiki 实例。
 * @param {string} lang - 已加载的语言 ID。
 * @returns {void} 替换分词器并让缓存颜色失效。
 */
function installTokenizer(monaco, highlighter, lang) {
	tokenProviders.get(lang)?.dispose()
	tokenProviders.set(lang, monaco.languages.setTokensProvider(lang, {
		/** @returns {TokenizerState} 首行的语法状态。 */
		getInitialState: () => new TokenizerState(),
		/**
		 * @param {string} line - 当前行。
		 * @param {TokenizerState} state - 上一行状态。
		 * @returns {object} 编码后的分词与下一行状态。
		 */
		tokenizeEncoded(line, state) {
			highlighter.setTheme(activeTheme)
			const result = highlighter.getLanguage(lang).tokenizeLine2(line, state.stack, 500)
			const tokens = result.tokens
			const languageId = monaco.languages.getEncodedLanguageId(lang)
			for (let index = 1; index < tokens.length; index += 2) {
				const metadata = tokens[index]
				tokens[index] = (metadata & 0x00007f00) | languageId
					| ((colorRemap[(metadata >>> 15) & 0x1ff] || 1) << 15)
					| ((colorRemap[metadata >>> 24] || 2) << 24)
			}
			return { tokens, endState: new TokenizerState(result.ruleStack) }
		},
	}))
}

/**
 * 显示层与编辑器统一使用 Monaco 自带的缩进/区域标记引擎。
 * @param {object} model - Monaco 文本模型。
 * @param {object} config - 语言配置。
 * @param {object} folding - Monaco 折叠实现。
 * @returns {object[]} 公开的 Monaco 折叠范围。
 */
function computeFoldLines(model, config, folding) {
	const ranges = folding.computeRanges(model, !!config.folding?.offSide, config.folding?.markers)
	return Array.from({ length: ranges.length }, (_, index) => ({ start: ranges.getStartLineNumber(index), end: ranges.getEndLineNumber(index) }))
}

/**
 * @param {string} token - DaisyUI 颜色令牌。
 * @returns {string} Monaco 可用的十六进制颜色。
 */
function themeColor(token) {
	const probe = document.createElement('span')
	probe.style.color = `var(--color-${token})`
	document.body.appendChild(probe)
	const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
	context.fillStyle = getComputedStyle(probe).color
	context.fillRect(0, 0, 1, 1)
	const color = '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')
	probe.remove()
	return color
}

const style = document.createElement('style')
style.textContent = CODE_SYNTAX_CSS
document.head.prepend(style)

/** Markdown、输入框与可编辑文件共用的一套主题。 */
export const CODE_THEMES = { light: 'github-light', dark: 'github-dark-dimmed' }
let highlighterPromise, shikiPromise

/** @returns {Promise<object>} Shiki 的语言注册表与构造函数。 */
function loadShiki() { return shikiPromise ||= import('https://esm.sh/shiki') }

/**
 * 复用同一个高亮器，只加载被请求的语法。
 * @param {object} [options={}] - pretty-code 高亮器选项。
 * @returns {Promise<object>} 共享 Shiki 高亮器。
 */
export async function loadCodeHighlighter(options = {}) {
	const shiki = await loadShiki()
	const highlighter = await (highlighterPromise ||= shiki.createHighlighter({ themes: Object.values(CODE_THEMES), langs: [] }).catch(error => {
		highlighterPromise = null
		throw error
	}))
	const pending = options.langs?.filter(lang => typeof lang !== 'string' || !highlighter.getLoadedLanguages().includes(lang)) || []
	if (pending.length) await highlighter.loadLanguage(...pending)
	return highlighter
}

/**
 * 从 Shiki 的语法注册表解析语言名与别名。
 * @param {string} name - 语言标识。
 * @returns {Promise<string>} 规范语言，或纯文本。
 */
export async function resolveCodeLanguage(name) {
	const { bundledLanguagesInfo } = await loadShiki()
	const key = name.toLowerCase()
	return customLanguages.get(key) || bundledLanguagesInfo.find(info => info.id === key || info.name.toLowerCase() === key || info.aliases?.includes(key))?.id || 'text'
}

/**
 * 解析文件语言，并在挂载模型前加载它的 TextMate 语法。
 * @param {string} path - 文件路径。
 * @returns {Promise<string>} Monaco/Shiki 语言 ID。
 */
export async function resolveFileLanguage(path) {
	const extension = path.split('.').at(-1).toLowerCase()
	const aliases = { cmd: 'bat', ps1: 'powershell', mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript', yml: 'yaml', h: 'c', hpp: 'cpp' }
	const lang = await resolveCodeLanguage(aliases[extension] || extension)
	const highlighter = await loadCodeHighlighter({ langs: lang === 'text' ? [] : [lang] })
	if (lang !== 'text') {
		const monaco = await loadCodeRuntime()
		if (!loadedEditorLanguages.has(lang)) {
			loadedEditorLanguages.add(lang)
			monaco.languages.register({ id: lang })
			const config = languageConfig(monaco, lang)
			monaco.languages.setLanguageConfiguration(lang, config)
			monaco.languages.registerFoldingRangeProvider(lang, {
				/**
				 * @param {object} model - 编辑器模型。
				 * @returns {object[]} 共享折叠范围。
				 */
				provideFoldingRanges: model => computeFoldLines(model, config, foldingEngine),
			})
			installTokenizer(monaco, highlighter, lang)
		}
	}
	return lang === 'text' ? 'plaintext' : lang
}

/**
 * 同时用 Shiki 和编辑器的折叠服务分析一段展示代码。
 * @param {string} text - 源码文本。
 * @param {string} language - 围栏语言或别名。
 * @returns {Promise<object>} 共享高亮范围与语法折叠范围。
 */
export async function analyzeCode(text, language) {
	const lang = await resolveCodeLanguage(language)
	const highlighter = await loadCodeHighlighter({ langs: lang === 'text' ? [] : [lang] })
	const result = highlighter.codeToTokens(text, { lang, themes: CODE_THEMES, defaultColor: false })
	const tokens = []
	for (const line of result.tokens)
		for (const token of line)
			tokens.push({ from: token.offset, to: token.offset + token.content.length,
				style: Object.entries(token.htmlStyle || {}).map(([key, value]) => `${key}:${value}`).join(';') })

	const monaco = await loadCodeRuntime()
	const model = monaco.editor.createModel(text, 'plaintext')
	let folds
	try {
		folds = computeFoldLines(model, languageConfig(monaco, lang), foldingEngine).map(range => ({
			from: model.getOffsetAt({ lineNumber: range.start, column: model.getLineMaxColumn(range.start) }),
			to: model.getOffsetAt({ lineNumber: range.end, column: model.getLineMaxColumn(range.end) }),
		}))
	} finally { model.dispose() }
	return { tokens, folds }
}

/**
 * 把用户提供的 TextMate 语法注册进共享编辑器运行时。
 * @param {object} definition - 语言 ID、别名、语法与配置。
 * @returns {Promise<void>} 语法与编辑器 provider 已安装。
 */
export async function registerCodeLanguage(definition) {
	const { id, aliases = [], grammar, configuration = {} } = definition
	const highlighter = await loadCodeHighlighter()
	await highlighter.loadLanguage({ ...grammar, name: id, aliases })
	for (const name of [id, ...aliases]) customLanguages.set(name.toLowerCase(), id)
	const monaco = await loadCodeRuntime()
	if (!loadedEditorLanguages.has(id)) monaco.languages.register({ id, aliases })
	loadedEditorLanguages.add(id)
	const config = monaco.convertVscodeLanguageConfiguration(structuredClone(configuration))
	languageConfigs.set(id, config)
	monaco.languages.setLanguageConfiguration(id, config)
	installTokenizer(monaco, highlighter, id)
}
