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
