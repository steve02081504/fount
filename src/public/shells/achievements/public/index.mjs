/**
 * 成就页面的主要客户端逻辑。
 */
import { unlockAchievement, loadPart } from '../../../scripts/endpoints.mjs'
import { geti18n, geti18n_nowarn, initTranslations } from '../../../scripts/i18n.mjs'
import { onServerEvent } from '../../../scripts/server_events.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'

import * as api from './src/endpoints.mjs'

const achievementsContainer = document.getElementById('achievements-container')

let render_lock

const shakeStates = new Map()
const MAX_CLICKS_TO_RELOCK = 13
const SHAKE_DECAY_TIME = 2000 // ms before shake starts to decay

/**
 * 对元素应用摇晃效果。
 * @param {HTMLElement} element - 要应用摇晃效果的元素。
 * @param {number} intensity - 摇晃强度。
 */
function applyShake(element, intensity) {
	if (intensity > 0) {
		element.style.setProperty('--shake-intensity', intensity.toString())
		element.classList.add('shaking')
	} else {
		element.style.setProperty('--shake-intensity', '0')
		element.classList.remove('shaking')
		element.style.transform = 'none' // Reset transform explicitly
	}
}

/**
 * 摇晃效果的衰减函数。
 * @param {HTMLElement} element - 要应用摇晃效果的元素。
 */
function decayShake(element) {
	const state = shakeStates.get(element)
	if (!state) return

	state.intensity *= 0.9 // Decay factor
	if (state.intensity < 0.5) { // Stop shaking if intensity is too low
		state.intensity = 0
		state.clicks = 0
		shakeStates.delete(element)
		applyShake(element, 0)
	} else {
		applyShake(element, state.intensity)
		state.timer = setTimeout(() => decayShake(element), 100)
	}
}

achievementsContainer.addEventListener('click', async (event) => {
	const card = event.target.closest('.achievement-card.unlocked')
	if (!card) return

	navigator?.vibrate?.(50)

	const { parttype, partname, id } = card.dataset

	let state = shakeStates.get(card)
	if (!state) {
		state = { clicks: 0, intensity: 0, timer: null }
		shakeStates.set(card, state)
	}

	clearTimeout(state.timer) // Reset decay timer on new click

	state.clicks++
	state.intensity = Math.min(state.clicks * 0.5, 5) // Increase intensity, with a cap

	applyShake(card, state.intensity)

	if (state.clicks >= MAX_CLICKS_TO_RELOCK) {
		card.style.pointerEvents = 'none' // Prevent further clicks
		card.classList.add('opacity-50')
		try {
			const result = await api.lockAchievement(parttype, partname, id, 'relock_by_clicking')
			if (result.success) // The server will send an event to reload, but we can do it faster
				await renderAchievements()
		} catch (e) {
			console.error('Failed to relock achievement', e)
			card.style.pointerEvents = 'auto'
			card.classList.remove('opacity-50')
		} finally {
			shakeStates.delete(card) // Clear state after attempt to relock
			applyShake(card, 0) // Ensure shake is removed
		}
	}
	else
		state.timer = setTimeout(() => decayShake(card), SHAKE_DECAY_TIME) // Start decay after a delay
})

/**
 * 从服务器获取所有成就数据并将其渲染到页面上。
 * 它会处理加载状态、错误，并根据需要异步加载 i18n 数据。
 * @returns {Promise<void>}
 */
async function renderAchievements() {
	if (render_lock) return
	render_lock = true
	try {
		achievementsContainer.innerHTML = /* html */ '<div class="text-center"><span class="loading loading-dots loading-md"></span></div>'
		const allSources = await api.getAllAchievements()
		achievementsContainer.innerHTML = ''

		for (const source of allSources) {
			const keys = ['name', 'description', 'locked_name', 'locked_description']
			const needsLoad = Object.values(source.achievements).some(a => keys.some(k => a[k] && !geti18n_nowarn(a[k])))
			const sectionId = `achievements-section-${source.parttype}-${source.partname}`
			if (needsLoad) {
				const skeleton = await renderTemplate('source_section_skeleton')
				skeleton.id = sectionId
				achievementsContainer.appendChild(skeleton)
				; (async () => {
					await loadPart(source.parttype, source.partname)
					await initTranslations()

					const { info, achievements } = source
					const totalAchievements = Object.keys(achievements).length
					const unlockedAchievements = Object.values(achievements).filter(a => a.unlocked_at).length
					const section = await renderTemplate('source_section', {
						parttype: source.parttype,
						partname: source.partname,
						source: info,
						achievements,
						totalAchievements,
						unlockedAchievements,
					})
					section.id = sectionId
					document.getElementById(sectionId)?.replaceWith(section)
				})()
			}
			else {
				const { info, achievements } = source
				const totalAchievements = Object.keys(achievements).length
				const unlockedAchievements = Object.values(achievements).filter(a => a.unlocked_at).length
				const section = await renderTemplate('source_section', {
					parttype: source.parttype,
					partname: source.partname,
					source: info,
					achievements,
					totalAchievements,
					unlockedAchievements,
				})
				section.id = sectionId
				achievementsContainer.appendChild(section)
			}
		}
	} catch (error) {
		console.error('Failed to load achievements:', error)
		achievementsContainer.innerHTML = `<p class="text-error">${geti18n('achievements.error.load_failed', { message: error.message })}</p>`
	} finally {
		render_lock = false
	}
}

/**
 * 应用程序的入口点。初始化主题、翻译、渲染成就并设置服务器事件监听器。
 * @returns {Promise<void>}
 */
async function main() {
	applyTheme()
	usingTemplates('/shells/achievements/templates')
	await initTranslations('achievements')
	await renderAchievements()

	unlockAchievement('shells', 'achievements', 'open_achievements_page')

	onServerEvent('achievement-unlocked', async () => {
		await renderAchievements()
	})

	onServerEvent('achievements-registry-updated', async () => {
		await renderAchievements()
	})
}

main()
