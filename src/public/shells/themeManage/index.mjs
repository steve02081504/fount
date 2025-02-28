import { initTranslations } from '../../scripts/i18n.mjs'
import { renderTemplate } from '../../scripts/template.mjs'
import { applyTheme, builtin_themes, setTheme, getCurrentTheme } from '../../scripts/theme.mjs'

applyTheme()
initTranslations('themeManage')

const themeList = document.getElementById('theme-list')

// 渲染主题预览
async function renderThemePreviews() {
	themeList.innerHTML = ''

	const currentTheme = getCurrentTheme()

	// 创建 "Auto" 主题预览
	const autoPreview = await createAutoPreview()
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, null))
	if (currentTheme === 'auto') autoPreview.classList.add('selected-theme')
	themeList.appendChild(autoPreview)

	// 创建其他内置主题预览
	for (const theme of builtin_themes) {
		const preview = await renderTemplate('theme_preview', { theme })
		preview.addEventListener('click', () => handleThemeClick(preview, theme))
		if (currentTheme === theme) preview.classList.add('selected-theme')
		themeList.appendChild(preview)
	}
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

// 初始渲染主题预览
renderThemePreviews()
