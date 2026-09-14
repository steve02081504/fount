/**
 * 主题字体方案：把字体角色（`--font-body` / `--font-heading` / `--font-code`，
 * 定义在 tokens.css）映射到具体字族。方案绑定到主题（`theme_fonts` 映射表），
 * 切换主题即恢复该主题的字体；自定义主题也可在自己的 CSS 里声明 `--font-*`。
 */

/** localStorage 中“主题 id → 字体方案 id”映射表的键名 */
const STORAGE_KEY = 'theme_fonts'

/** 方案样式与网络字体样式表的 DOM id */
const STYLE_ID = 'font-scheme-style'
const FONT_LINK_ID = 'font-scheme-fonts'

/**
 * 内置字体方案。`label` 是给 UI 的专有名词，无需本地化。
 * @type {Record<string, { label: string, body: string, heading?: string, code?: string, url?: string }>}
 */
export const FONT_SCHEMES = {
	system: {
		label: 'System',
		body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
		code: 'ui-monospace, SFMono-Regular, "Cascadia Code", "Fira Code", Consolas, monospace',
	},
	inter: {
		label: 'Inter',
		body: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
		code: '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
		url: 'https://fonts.bunny.net/css?family=inter:400,500,600,700,800|jetbrains-mono:400,500',
	},
	geist: {
		label: 'Geist',
		body: '"Geist", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
		code: '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
		url: 'https://fonts.bunny.net/css?family=geist:400,500,600,700,800|geist-mono:400,500',
	},
	'noto-sans-sc': {
		label: 'Noto Sans SC',
		body: '"Noto Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		url: 'https://fonts.bunny.net/css?family=noto-sans-sc:400,500,700',
	},
	'lxgw-wenkai': {
		label: 'LXGW WenKai',
		body: '"LXGW WenKai", "Noto Serif SC", system-ui, -apple-system, "Segoe UI", serif',
		url: 'https://fonts.bunny.net/css?family=lxgw-wenkai:400,700',
	},
}

/**
 * 读取“主题 → 方案”映射表。
 * @returns {Record<string, string>} 映射表
 */
function readSchemeMap() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
	}
	catch {
		return {}
	}
}

/**
 * 解析某主题的字体方案 id。
 * @param {string} themeId 主题 id
 * @returns {string} 方案 id（未知则 system）
 */
export function getThemeFontScheme(themeId) {
	const schemeId = readSchemeMap()[themeId]
	return FONT_SCHEMES[schemeId] ? schemeId : 'system'
}

/**
 * 把方案样式插到自定义主题样式之前，保证自定义主题的 `--font-*` 能覆盖方案。
 * @param {HTMLStyleElement} style 方案样式
 * @returns {void}
 */
function insertBeforeCustomTheme(style) {
	const customThemeStyle = document.getElementById('custom-theme-style')
	if (customThemeStyle) document.head.insertBefore(style, customThemeStyle)
	else document.head.appendChild(style)
}

/**
 * 应用字体方案：注入角色变量样式，并按需加载网络字体。
 * @param {string} schemeId 方案 id
 * @returns {void}
 */
export function applyFontScheme(schemeId) {
	const scheme = FONT_SCHEMES[schemeId] || FONT_SCHEMES.system

	let style = document.getElementById(STYLE_ID)
	if (!style) {
		style = document.createElement('style')
		style.id = STYLE_ID
		insertBeforeCustomTheme(style)
	}
	style.textContent = `:root {\n\t--font-body: ${scheme.body};\n`
		+ (scheme.heading ? `\t--font-heading: ${scheme.heading};\n` : '')
		+ (scheme.code ? `\t--font-code: ${scheme.code};\n` : '')
		+ '}\n'

	document.getElementById(FONT_LINK_ID)?.remove()
	if (scheme.url) {
		const link = document.createElement('link')
		link.id = FONT_LINK_ID
		link.rel = 'stylesheet'
		link.href = scheme.url
		document.head.appendChild(link)
	}
}

/**
 * 应用某主题的字体方案。
 * @param {string} themeId 主题 id
 * @returns {void}
 */
export function applyThemeFontScheme(themeId) {
	applyFontScheme(getThemeFontScheme(themeId))
}

/**
 * 为某主题设置字体方案并立即应用（选择器场景即当前主题）。
 * @param {string} themeId 主题 id
 * @param {string} schemeId 方案 id
 * @returns {void}
 */
export function setThemeFontScheme(themeId, schemeId) {
	const map = readSchemeMap()
	map[themeId] = FONT_SCHEMES[schemeId] ? schemeId : 'system'
	localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
	applyFontScheme(map[themeId])
}
