import { confirmI18n, initTranslations, promptI18n } from '/scripts/i18n.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { makeSearchable } from '/scripts/search.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { unlockAchievement } from '/scripts/parts.mjs'
import {
	applyTheme,
	builtin_themes,
	getCurrentTheme,
	setCustomTheme,
	setTheme,
} from '/scripts/theme.mjs'
import {
	applyThemeWithViewTransition,
	createAutoPreview,
} from '/scripts/themeViewTransition.mjs'

import { extractColorsFromImage } from './colorUtils.mjs'

applyTheme()
await initTranslations('themeManage')
usingTemplates('/parts/shells:themeManage/templates')

const themeListContainer = document.getElementById('theme-list')
const listPanel = themeListContainer.parentElement // 右侧面板容器
let searchInput = document.getElementById('theme-search-input')

// State
let customThemes = []
let isEditMode = false
let currentEditId = null
let previewStyleTag = null

// --- API Calls ---

/**
 * 获取自定义主题列表并将其CSS注入到页面中。
 * @returns {Promise<void>}
 */
async function fetchCustomThemes() {
	const res = await fetch('/api/parts/shells:themeManage/list')
	if (res.ok) {
		customThemes = await res.json()
		// Inject Custom CSS for Previews
		let styleTag = document.getElementById('custom-themes-css')
		if (!styleTag) {
			styleTag = document.createElement('style')
			styleTag.id = 'custom-themes-css'
			document.head.appendChild(styleTag)
		}
		styleTag.textContent = customThemes.map((t) => t.css).join('\n')
	} else
		customThemes = []
}

// --- List View Logic ---

/**
 * 渲染主题列表，包括自定义主题和内置主题，并设置搜索功能。
 * @returns {Promise<void>}
 */
async function renderList() {
	if (isEditMode) return // Prevent rendering list when in edit mode
	await fetchCustomThemes()

	// Prepare data for search/render
	// Merged list: "auto" (follow system) first, then custom, then built-in from daisyUI
	const allItems = [
		{ id: 'auto', type: 'builtin' },
		...customThemes.map((t) => ({ id: t.id, type: 'custom', data: t })),
		...builtin_themes.map((t) => ({ id: t, type: 'builtin' })),
	]

	// Get the grid container
	const grid = document.getElementById('theme-grid')

	// Bind create button event (only once)
	const createBtn = document.getElementById('create-theme-btn')
	if (createBtn && !createBtn.hasAttribute('data-bound')) {
		createBtn.dataset.bound = 'true'
		/**
		 * 创建一个新的主题。
		 * @returns {void}
		 */
		createBtn.onclick = () => openEditor(null) // New theme
	}

	// Re-create search input to remove old listeners
	const newSearchInput = searchInput.cloneNode(true)
	newSearchInput.value = searchInput.value
	searchInput.replaceWith(newSearchInput)
	searchInput = newSearchInput

	makeSearchable({
		searchInput,
		data: allItems,
		/**
		 * 提取搜索项的数据以供搜索。
		 * @param {object} item - 搜索项。
		 * @returns {object} 返回包含名称和ID的对象。
		 */
		dataAccessor: (item) => ({
			name: item.type === 'custom' ? item.id : item.id,
			id: item.id,
		}),
		/**
		 * 当搜索结果更新时，重新渲染主题预览卡片。
		 * @param {Array<object>} filtered - 过滤后的搜索结果。
		 * @returns {Promise<void>}
		 */
		onUpdate: async (filtered) => {
			grid.innerHTML = ''
			const currentTheme = getCurrentTheme()

			const previews = await Promise.all(filtered.map(async (item) => {
				const isCustom = item.type === 'custom'

				const preview = item.id === 'auto' ? await createAutoPreview() : await renderTemplate('theme_preview', {
					theme: item.id,
					name: item.id,
					isCustom,
				})

				// Click to Apply (with circle-reveal animation)
				preview.addEventListener('click', (e) => {
					if (e.target.closest('button')) return
					applyThemeWithAnimation(e, item.id, isCustom)
				})

				// Highlight selected
				if (currentTheme === item.id) preview.classList.add('selected-theme')

				// Action Buttons Logic
				if (isCustom) {
					preview.querySelector('.edit-btn')?.addEventListener(
						'click',
						() => openEditor(item.data),
					)
					preview.querySelector('.delete-btn')?.addEventListener(
						'click',
						() => handleDelete(item.id),
					)
				}
				if (item.id !== 'auto') preview.querySelector('.clone-btn')?.addEventListener(
					'click',
					() => handleClone(item.id, isCustom),
				)

				return preview
			}))
			grid.append(...previews)
		},
	})
}

/**
 * 更新UI以显示当前选定的主题。
 * 仅匹配 grid 的直接子卡片，避免选中 auto 卡片内部的 light/dark 半块。
 * @param {string} id - 主题的ID。
 * @returns {void}
 */
function updateSelectedUI(id) {
	const grid = document.getElementById('theme-grid')
	grid?.querySelectorAll(':scope > .theme-preview-card').forEach((el) =>
		el.classList.remove('selected-theme')
	)
	const target = grid?.querySelector(
		`:scope > .theme-preview-card[data-theme="${id}"]`
	)
	if (target) target.classList.add('selected-theme')
}

/**
 * 使用 View Transition API：从点击处圆圈扩散，圈内直接显示新主题内容。
 * @param {MouseEvent} e - 点击事件（取坐标）
 * @param {string} id - 主题ID
 * @param {boolean} isCustom - 是否自定义主题
 */
async function applyThemeWithAnimation(e, id, isCustom) {
	await applyThemeWithViewTransition(e, async () => {
		await handleThemeApply(id, isCustom)
		updateSelectedUI(id)
	})
}

/**
 * 应用指定的主题（无动画，供编辑器保存等场景使用）。
 * @param {string} id - 要应用的主题ID。
 * @param {boolean} isCustom - 主题是否为自定义主题。
 * @returns {Promise<void>}
 */
async function handleThemeApply(id, isCustom) {
	if (isCustom) {
		const url = `/api/parts/shells:themeManage/theme/${id}`
		await setCustomTheme(id, url)
	} else
		setTheme(id)
	unlockAchievement('shells/themeManage', 'change_theme')
}

/**
 * 删除指定的自定义主题。
 * @param {string} id - 要删除的主题ID。
 * @returns {Promise<void>}
 */
async function handleDelete(id) {
	if (!await confirmI18n('themeManage.editor.deleteConfirm', { id })) return
	await fetch(`/api/parts/shells:themeManage/theme/${id}`, { method: 'DELETE' })
	if (getCurrentTheme() === id) setTheme('light') // Fallback
	renderList()
}

/**
 * 克隆指定的主题并创建一个新的自定义主题。
 * @param {string} id - 要克隆的主题ID。
 * @param {boolean} isCustom - 主题是否为自定义主题。
 * @returns {Promise<void>}
 */
async function handleClone(id, isCustom) {
	let css = ''
	if (isCustom) {
		const res = await fetch(`/api/parts/shells:themeManage/theme/${id}`)
		const data = await res.json()
		css = data.css
	} else {
		// Generate CSS from built-in theme
		const vars = []
		DAISY_COLORS.forEach((color) => {
			const hex = getComputedColor(color, id)
			vars.push(`--color-${color}: ${hex};`)
			if (DAISY_MAP[color])
				vars.push(`--${DAISY_MAP[color]}: from ${hex} l c h;`)
		})

		// Try to read common variables
		const container = document.createElement('div')
		container.dataset.theme = id
		container.style.position = 'absolute'
		container.style.visibility = 'hidden'
		container.style.pointerEvents = 'none'
		document.body.appendChild(container)

		const roundedBox = getComputedStyle(container).getPropertyValue('--rounded-box').trim()
		const borderBtn = getComputedStyle(container).getPropertyValue('--border-btn').trim()

		document.body.removeChild(container)

		if (roundedBox) vars.push(`--rounded-box: ${roundedBox};`)
		if (borderBtn) vars.push(`--border-btn: ${borderBtn};`)

		css = `[data-theme="PLACEHOLDER"] {\n  ${vars.join('\n  ')}\n}`
	}

	const newId = await promptI18n('themeManage.editor.newThemeName', { id }, `copy-${id}`)
	if (!newId) return

	const newData = {
		id: newId,
		css: css.replace('PLACEHOLDER', newId),
	}

	// If cloning a custom theme with MJS, include it
	if (isCustom) {
		const res = await fetch(`/api/parts/shells:themeManage/theme/${id}`)
		const data = await res.json()
		if (data.mjs) newData.mjs = data.mjs
	}

	await fetch('/api/parts/shells:themeManage/save', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(newData),
	})
	renderList()
}

// --- Editor Logic ---

// --- Helpers ---

const DAISY_COLORS = [
	'primary',
	'primary-content',
	'secondary',
	'secondary-content',
	'accent',
	'accent-content',
	'neutral',
	'neutral-content',
	'base-100',
	'base-200',
	'base-300',
	'base-content',
	'info',
	'success',
	'warning',
	'error',
]

const DAISY_MAP = {
	primary: 'p',
	'primary-content': 'pc',
	secondary: 's',
	'secondary-content': 'sc',
	accent: 'a',
	'accent-content': 'ac',
	neutral: 'n',
	'neutral-content': 'nc',
	'base-100': 'b1',
	'base-200': 'b2',
	'base-300': 'b3',
	'base-content': 'bc',
	info: 'in',
	success: 'su',
	warning: 'wa',
	error: 'er',
}

const CLASS_MAP = {
	primary: 'bg-primary',
	'primary-content': 'bg-primary-content',
	secondary: 'bg-secondary',
	'secondary-content': 'bg-secondary-content',
	accent: 'bg-accent',
	'accent-content': 'bg-accent-content',
	neutral: 'bg-neutral',
	'neutral-content': 'bg-neutral-content',
	'base-100': 'bg-base-100',
	'base-200': 'bg-base-200',
	'base-300': 'bg-base-300',
	'base-content': 'bg-base-content',
	info: 'bg-info',
	success: 'bg-success',
	warning: 'bg-warning',
	error: 'bg-error',
}

/**
 * 获取指定主题下颜色变量的计算值 (十六进制格式)。
 * @param {string} colorName - 颜色变量的名称 (例如 'primary')。
 * @param {string} [themeId] - 可选，要从中获取颜色的主题ID。
 * @returns {string} - 颜色的十六进制表示。
 */
const getComputedColor = (colorName, themeId) => {
	const container = document.createElement('div')
	if (themeId) container.dataset.theme = themeId
	// Hide it but keep it in DOM for computation
	container.style.position = 'absolute'
	container.style.visibility = 'hidden'
	container.style.pointerEvents = 'none'

	const dummy = document.createElement('div')
	dummy.className = CLASS_MAP[colorName] || ''

	container.appendChild(dummy)
	document.body.appendChild(container)

	const col = getComputedStyle(dummy).backgroundColor

	document.body.removeChild(container)

	// 使用 Canvas 强制将颜色（包括 oklch, hsl, named colors）转换为 RGBA
	const canvas = document.createElement('canvas')
	canvas.width = 1
	canvas.height = 1
	const ctx = canvas.getContext('2d')
	ctx.fillStyle = col
	ctx.fillRect(0, 0, 1, 1)
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data

	// Convert to hex
	return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

/**
 * 获取指定主题下CSS变量的计算值。
 * @param {string} varName - CSS变量的名称 (例如 '--rounded-box')。
 * @param {string} [themeId] - 可选，要从中获取变量的主题ID。
 * @returns {string} - CSS变量的计算值。
 */
const getComputedVar = (varName, themeId) => {
	const container = document.createElement('div')
	if (themeId) container.dataset.theme = themeId
	container.style.position = 'absolute'
	container.style.visibility = 'hidden'
	container.style.pointerEvents = 'none'
	document.body.appendChild(container)
	const val = getComputedStyle(container).getPropertyValue(varName).trim()
	document.body.removeChild(container)
	return val
}

// --- Editor Logic ---

/**
 * 在CSS字符串中查找主题块的范围 (例如 `[data-theme=\"...\"] { ... }`)。
 * @param {string} css - 包含主题块的CSS字符串。
 * @returns {object|null} - 包含主题块的起始和结束索引的对象，如果未找到则为null。
 */
function findThemeBlockRange(css) {
	const startMatch = css.match(/\[data-theme="[^"]+"]\s*{/)
	if (!startMatch) return null

	const startIndex = startMatch.index + startMatch[0].length
	let openCount = 1
	let endIndex = -1

	for (let i = startIndex; i < css.length; i++) {
		if (css[i] === '{') openCount++
		else if (css[i] === '}') openCount--

		if (!openCount) {
			endIndex = i
			break
		}
	}

	if (endIndex !== -1)
		return { start: startIndex, end: endIndex, fullStart: startMatch.index }

	return null
}

/**
 * 打开主题编辑器界面，加载主题数据或准备创建新主题。
 * @param {object|null} themeData - 要编辑的主题数据对象，如果为null则创建新主题。
 * @returns {Promise<void>}
 */
async function openEditor(themeData) {
	isEditMode = true
	currentEditId = themeData ? themeData.id : ''

	// Render Editor
	const editorHtml = await renderTemplate('editor', {
		isNew: !themeData,
		name: currentEditId,
		css: themeData ? themeData.css : '',
	})

	// Swap View
	themeListContainer.style.display = 'none'
	searchInput.parentElement.style.display = 'none' // Hide search bar
	listPanel.appendChild(editorHtml)

	// --- Bind Editor Events ---

	const nameInput = listPanel.querySelector('#theme-name')
	const cssInput = listPanel.querySelector('#custom-css-input')
	const mjsInput = listPanel.querySelector('#custom-mjs-input')

	if (themeData) {
		cssInput.value = themeData.css || ''
		mjsInput.value = themeData.mjs || ''
	}
	else {
		cssInput.value = `\
[data-theme="${nameInput.value || 'my-theme'}"] {}
`
		mjsInput.value = `\
({
	load() {},
	unload() {},
})
`
	}

	// Generate Color Inputs
	const coreContainer = listPanel.querySelector('#color-inputs-core')
	const baseContainer = listPanel.querySelector('#color-inputs-base')

	/**
	 * 根据名称查找主题颜色，优先从自定义CSS中查找，否则计算得到。
	 * @param {string} name - 颜色名称。
	 * @returns {string} - 找到的颜色值 (十六进制)。
	 */
	const findColor = (name) => {
		if (themeData?.css) {
			// Try to find --color-name
			const re = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})`, 'i')
			const match = themeData.css.match(re)
			if (match) return match[1]
		}
		// Fallback to computed (from current theme if new, or just default)
		// If it's a new theme (no themeData), we might want to default to something safe
		return getComputedColor(name, currentEditId || getCurrentTheme())
	}

	DAISY_COLORS.forEach((color) => {
		const isBase = color.startsWith('base')
		const container = isBase ? baseContainer : coreContainer

		const wrapper = document.createElement('div')
		wrapper.className = 'flex items-center justify-between'
		wrapper.innerHTML = `\
<span class="text-xs uppercase opacity-70">${color}</span>
<input type="color" data-color="${color}" class="color-picker h-6 w-10 p-0 border-0 bg-transparent" value="${findColor(color)}">
`
		container.appendChild(wrapper)
	})

	// Live Preview Logic
	/**
	 * 实时更新主题预览，反映编辑器中的CSS和颜色选择。
	 * @returns {void}
	 */
	const updatePreview = () => {
		const id = nameInput.value || 'temp-preview'
		let css = cssInput.value

		let blockRange = findThemeBlockRange(css)

		if (!blockRange) {
			// Initialize if empty or invalid
			css = `[data-theme="${id}"] {\n}`
			blockRange = findThemeBlockRange(css)
		}

		// Update Selector (ID)
		const preBlock = css.substring(0, blockRange.start)
		const newPreBlock = preBlock.replace(/\[data-theme="[^"]+"]/, `[data-theme="${id}"]`)

		const lengthDiff = newPreBlock.length - preBlock.length
		css = newPreBlock + css.substring(blockRange.start)
		blockRange.start += lengthDiff
		blockRange.end += lengthDiff

		// Update Variables
		let blockContent = css.substring(blockRange.start, blockRange.end)

		/**
		 * 更新CSS内容中的一个变量，如果不存在则添加。
		 * @param {string} txt - 待更新的CSS内容。
		 * @param {string} key - CSS变量的键。
		 * @param {string} val - CSS变量的新值。
		 * @returns {string} 更新后的CSS内容。
		 */
		const updateVar = (txt, key, val) => {
			// Escape special chars in key if needed, but our keys are safe
			const re = new RegExp(`(${key}\\s*:\\s*)([^;]+)(;)`)
			if (re.test(txt))
				return txt.replace(re, `$1${val}$3`)

			return txt + `\n\t${key}: ${val};`
		}

		listPanel.querySelectorAll('input[type="color"]').forEach((input) => {
			const colorName = input.dataset.color
			const hex = input.value
			blockContent = updateVar(blockContent, `--color-${colorName}`, hex)
			if (DAISY_MAP[colorName])
				blockContent = updateVar(blockContent, `--${DAISY_MAP[colorName]}`, `oklch(from ${hex} l c h)`)
		})

		listPanel.querySelectorAll('.css-slider').forEach((input) => {
			let val = input.value
			if (input.dataset.var === '--rounded-box') val += 'rem'
			if (input.dataset.var === '--border-btn') val += 'px'
			blockContent = updateVar(blockContent, input.dataset.var, val)
		})

		// Reassemble
		if (!blockContent.endsWith('\n')) blockContent += '\n'
		css = css.substring(0, blockRange.start) + blockContent + css.substring(blockRange.end)

		// Only update textarea if user hasn't focused it
		if (document.activeElement !== cssInput)
			cssInput.value = css


		// Inject into DOM
		if (!previewStyleTag) {
			previewStyleTag = document.createElement('style')
			document.head.appendChild(previewStyleTag)
		}
		previewStyleTag.textContent = cssInput.value

		// Force preview area to use this theme
		document.documentElement.dataset.theme = id
	}

	// Bind Inputs
	listPanel.querySelectorAll('input').forEach((input) => {
		input.addEventListener('input', updatePreview)
	})

	// Image Palette Logic
	const imgUpload = listPanel.querySelector('#img-upload')
	const paletteResult = listPanel.querySelector('#palette-result')

	imgUpload.addEventListener('change', async (e) => {
		if (!e.target.files.length) return
		const url = URL.createObjectURL(e.target.files[0])

		const imgPreview = listPanel.querySelector('#img-preview')
		if (imgPreview) {
			imgPreview.src = url
			imgPreview.classList.remove('hidden')
		}

		// Show the instruction text
		const instructionEl = listPanel.querySelector('#auto-palette-instruction')
		paletteResult.classList.remove('hidden')
		instructionEl.classList.remove('hidden')

		const colors = await extractColorsFromImage(url)

		paletteResult.innerHTML = ''
		colors.forEach((c, idx) => {
			const dot = document.createElement('div')
			dot.className =
				'w-8 h-8 rounded-full cursor-pointer hover:scale-110 transition-transform ring-1 ring-base-content/20'
			dot.style.backgroundColor = c
			/**
			 * 点击调色板颜色点时，将其应用到主色输入框。
			 * @returns {void}
			 */
			dot.onclick = () => {
				// Auto fill logic: Apply this color to Primary, then next to Secondary?
				// Simple: Just fill Primary
				const primaryInput = listPanel.querySelector(
					'input[data-color="primary"]',
				)
				primaryInput.value = c
				primaryInput.dispatchEvent(new Event('input'))
			}
			paletteResult.appendChild(dot)
		})

		// Auto fill "Smartly" (Just first 4 colors to P, S, A, N)
		const map = ['primary', 'secondary', 'accent', 'neutral']
		colors.forEach((c, i) => {
			if (i < 4) {
				const input = listPanel.querySelector(`input[data-color="${map[i]}"]`)
				if (input) {
					input.value = c
					input.dispatchEvent(new Event('input'))
				}
			}
		})
	})

	// Save
	listPanel.querySelector('#editor-save').addEventListener(
		'click',
		async () => {
			const id = nameInput.value
			if (!id) return showToastI18n('error', 'themeManage.editor.themeIdRequired')

			const payload = {
				id,
				css: cssInput.value,
			}

			// Add MJS if provided
			if (mjsInput.value.trim())
				payload.mjs = mjsInput.value
			else
				payload.mjs = `\
({
	async load() { },
	async unload() { }
})
`

			const res = await fetch('/api/parts/shells:themeManage/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})

			if (res.ok) {
				showToastI18n('success', 'themeManage.editor.saved')
				handleThemeApply(id, true)
				closeEditor()
			} else showToastI18n('error', 'themeManage.editor.failedToSave')
		},
	)

	// Cancel
	listPanel.querySelector('#editor-cancel').addEventListener(
		'click',
		closeEditor,
	)

	// Init Preview
	updatePreview()
}

/**
 * 关闭主题编辑器界面，清理相关DOM元素和状态，并恢复主题列表。
 * @returns {void}
 */
function closeEditor() {
	isEditMode = false
	currentEditId = null

	// Cleanup Editor DOM
	const editorEl = listPanel.querySelector('.h-full.flex.flex-col') // Identify editor root
	if (editorEl) editorEl.remove()

	// Restore List
	themeListContainer.style.display = ''
	searchInput.parentElement.style.display = ''

	// Cleanup Preview Style
	if (previewStyleTag) {
		previewStyleTag.remove()
		previewStyleTag = null
	}

	// Restore Theme from system (in case preview messed it up)
	const actualTheme = getCurrentTheme()
	setTheme(actualTheme)

	renderList()
}

// Initial Run
renderList()
