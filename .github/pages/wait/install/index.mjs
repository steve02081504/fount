import { setBaseDir, setPreRender, setTheme, theme_now } from '../../scripts/base.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { isFountServiceAvailable, saveFountHostUrl, getFountHostUrl } from '../../scripts/fountHostGetter.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import * as Sentry from 'https://esm.run/@sentry/browser'

setBaseDir('../..')
usingTemplates('wait/install/templates')
const hostUrl = 'http://localhost:8931'

const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const footerReadyText = document.getElementById('footerReadyText')
const themeSelectionSection = document.getElementById('theme-selection-section')

// --- Theme Selection ---
const themes = Object.keys(await import('https://cdn.jsdelivr.net/npm/daisyui/theme/object.js').then(m => m.default)).sort()

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
	await initTranslations('installer_wait_screen')
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

	// Start Fount service check
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
