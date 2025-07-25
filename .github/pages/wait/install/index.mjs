import { setBaseDir, setPreRender, setTheme, theme_now } from '../../base.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { isFountServiceAvailable, saveFountHostUrl, getFountHostUrl } from '../../scripts/fountHostGetter.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import * as Sentry from 'https://esm.run/@sentry/browser'
import { animateSVG } from 'https://cdn.jsdelivr.net/gh/steve02081504/animate-SVG/index.mjs'

setBaseDir('../..')
usingTemplates('wait/install/templates')
const hostUrl = 'http://localhost:8931'

const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const footerReadyText = document.getElementById('footerReadyText')

// --- Hero Intro Animation ---
async function playHeroAnimation() {
	const heroElement = document.querySelector('.hero')
	const animationContainer = document.getElementById('hero-animation-bg')
	const heroOverlay = document.querySelector('.hero-overlay')
	const heroContent = document.querySelector('.hero-content')

	try {
		// 1. 锁定滚动
		document.body.classList.add('scroll-lock')

		const response = await fetch('https://steve02081504.github.io/fount/imgs/repo-img.svg')
		if (!response.ok) throw new Error(`Failed to load SVG: ${response.statusText}`)

		const svgText = await response.text()
		const svgElement = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement

		// 确保SVG preserveAspectRatio 与 object-fit: cover 行为匹配
		svgElement.setAttribute('preserveAspectRatio', 'xMidYMid slice')

		animationContainer.appendChild(svgElement)

		// 播放动画并获取持续时间
		animateSVG(svgElement)
		const durationMs = 3100

		// 动画结束后执行
		setTimeout(() => {
			// 1. 淡入 Hero 文字和遮罩
			heroOverlay.classList.add('visible-after-intro')
			heroContent.classList.add('visible-after-intro')

			// 2. 加载最终的背景图
			heroElement.classList.add('bg-image-loaded')

			// 3. 淡出 SVG 动画
			animationContainer.style.opacity = '0'

			// 4. 解锁滚动
			document.body.classList.remove('scroll-lock')

			// 5. 在淡出动画后彻底移除SVG，释放资源
			setTimeout(() => animationContainer.remove(), 800)
		}, durationMs)
	}
	catch (error) {
		console.error('Hero animation failed:', error)
		// 如果动画失败，直接显示最终效果
		heroOverlay.classList.add('visible-after-intro')
		heroContent.classList.add('visible-after-intro')
		heroElement.classList.add('bg-image-loaded')
		animationContainer.remove()
		// 确保在出错时也解锁滚动
		document.body.classList.remove('scroll-lock')
	}
}

// --- Theme Selection ---
const themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default)

const themeList = document.getElementById('theme-list')

// Create "Auto" theme preview function
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

// Render theme previews
async function renderThemePreviews() {
	themeList.innerHTML = ''

	const currentTheme = theme_now

	// Create "Auto" theme preview
	const autoPreview = await createAutoPreview()
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, 'auto'))
	if (!currentTheme) autoPreview.classList.add('selected-theme')
	themeList.appendChild(autoPreview)

	for (const theme of themes) {
		const preview = await renderTemplate('theme_preview', { theme })

		if (!preview) {
			console.error(`Failed to render preview for theme: ${theme}`)
			continue
		}

		preview.addEventListener('click', () => handleThemeClick(preview, theme))

		if (theme_now === theme)
			preview.classList.add('selected-theme')

		themeList.appendChild(preview)
	}
}

// Update selected theme style
function updateSelectedTheme(selectedElement) {
	document.querySelectorAll('.theme-preview-card').forEach(el => el.classList.remove('selected-theme'))
	selectedElement.classList.add('selected-theme')
}

// Handle theme click
function handleThemeClick(previewElement, theme) {
	const applyNewTheme = () => {
		setTheme(theme)
		updateSelectedTheme(previewElement)
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

	document.startViewTransition(applyNewTheme)
}

// --- Main Execution ---
async function main() {
	// Start the intro animation and translations in parallel
	await Promise.all([
		initTranslations('installer_wait_screen'),
		playHeroAnimation()
	])

	// Initial render
	renderThemePreviews()

	// Set up animations
	const featureSections = document.querySelectorAll('.feature-section')
	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add('visible')
				observer.unobserve(entry.target)
			}
		})
	}, { threshold: 0.2 })
	featureSections.forEach(section => {
		observer.observe(section)
	})

	// Start fount service check
	async function checkFountInstallerAlive() {
		try {
			const response = await fetch('http://localhost:8930')
			if (!response.ok) return false
		}
		catch (e) { return false }
		return true
	}
	if (await checkFountInstallerAlive()) {
		document.getElementById('theme-selection-section').style.display = 'block'
		document.getElementById('mini-game-section').style.display = 'block'
		footerReadyText.textContent = geti18n('installer_wait_screen.footer.wait_text')
		const timer = setInterval(async () => {
			if (!await checkFountInstallerAlive()) {
				window.location.href = './error'
				clearInterval(timer)
				return
			}
			if (await isFountServiceAvailable(hostUrl)) {
				saveFountHostUrl(hostUrl)
				setPreRender(hostUrl)
				footerReadyText.textContent = geti18n('installer_wait_screen.footer.ready_text')
				launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
				launchButton.onclick = () => window.location.href = hostUrl + '?theme=' + theme_now
				launchButtonSpinner.style.display = 'none'

				if (footer) {
					footer.classList.remove('fixed', 'bottom-0', 'w-full', 'z-50')
					footer.classList.add('sticky', 'bottom-0', 'w-full', 'z-50')
				}

				clearInterval(timer)
			}
		}, 1000)
	}
	else {
		launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_or_install_fount')
		launchButton.onclick = () => {
			setTimeout(() => {
				window.location.href = 'https://github.com/steve02081504/fount'
			}, 1000)
			window.location.href = 'fount://page/shells/home'
		}
		launchButtonSpinner.style.display = 'none'
		const hostUrl = await getFountHostUrl()

		if (hostUrl) {
			launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
			launchButton.onclick = () => window.location.href = new URL('/shells/home', hostUrl)
		}
		return
	}
}

main().catch(e => {
	Sentry.captureException(e)
	alert(geti18n('installer_wait_screen.footer.error_message') + e.message)
	window.location.href = 'https://github.com/steve02081504/fount'
})
