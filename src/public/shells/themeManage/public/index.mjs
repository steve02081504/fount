import { unlockAchievement } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { makeSearchable } from '../../scripts/search.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { applyTheme, builtin_themes, setTheme, getCurrentTheme } from '../../scripts/theme.mjs'

applyTheme()
await initTranslations('themeManage')
usingTemplates('/shells/themeManage/templates')

const themeList = document.getElementById('theme-list')
const searchInput = document.getElementById('theme-search-input')
const allThemes = ['auto', ...builtin_themes]

// 渲染主题预览
async function renderThemePreviews(themesToRender = allThemes) {
	themeList.innerHTML = ''
	if (!themesToRender.length) return themeList.append(await renderTemplate('no_result'))
	const currentTheme = getCurrentTheme()

	const previews = await Promise.all(themesToRender.map(async (theme) => {
		const isAuto = theme === 'auto'
		const preview = isAuto
			? await createAutoPreview()
			: await renderTemplate('theme_preview', { theme })

		preview.addEventListener('click', () => handleThemeClick(preview, theme))

		const isSelected = (isAuto && !currentTheme) || currentTheme === theme
		if (isSelected)
			preview.classList.add('selected-theme')
		return preview
	}))
	themeList.append(...previews)
}

// 创建 "Auto" 主题预览的函数
async function createAutoPreview() {
	const container = document.createElement('div')
	container.classList.add('theme-preview-card', 'cursor-pointer', 'auto-theme-container')

	const darkHalf = await renderTemplate('theme_preview', { theme: 'dark', name: 'auto' })
	const lightHalf = await renderTemplate('theme_preview', { theme: 'light', name: 'auto' })

	darkHalf.classList.add('auto-theme-half', 'auto-theme-dark')
	lightHalf.classList.add('auto-theme-half', 'auto-theme-light')

	container.appendChild(lightHalf)
	container.appendChild(darkHalf)

	return container
}

// 更新选中主题的样式
function updateSelectedTheme(selectedElement) {
	document.querySelectorAll('.theme-preview-card').forEach(el => el.classList.remove('selected-theme'))
	selectedElement.classList.add('selected-theme')
}

// 处理主题点击事件
async function handleThemeClick(previewElement, theme) {
	unlockAchievement('shells', 'themeManage', 'change_theme')
	const applyNewTheme = () => {
		setTheme(theme)
		updateSelectedTheme(previewElement) // 调用新函数
	}
	if (!document.startViewTransition) {
		applyNewTheme()
		return
	}

	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (prefersReducedMotion) {
		applyNewTheme()
		return
	}

	document.startViewTransition(() => applyNewTheme())
}

// 初始渲染 and search functionality
makeSearchable({
	searchInput,
	data: allThemes,
	dataAccessor: (theme) => {
		const name = geti18n(`themeManage.themes.${theme}`) || theme
		return { name, theme }
	},
	onUpdate: renderThemePreviews,
})
