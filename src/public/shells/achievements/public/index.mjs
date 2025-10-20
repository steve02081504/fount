import { unlockAchievement } from '../../../scripts/endpoints.mjs'
import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { getPartDetails } from '../../../scripts/parts.mjs'
import { onServerEvent } from '../../../scripts/server_events.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'

import * as api from './src/endpoints.mjs'

const achievementsContainer = document.getElementById('achievements-container')

let render_lock
async function renderAchievements() {
	if (render_lock) return
	render_lock = true
	try {
		achievementsContainer.innerHTML = '<div class="text-center"><span class="loading loading-dots loading-md"></span></div>'
		const result = await api.getAchievements()

		if (!result.success) throw new Error(result.message)

		achievementsContainer.innerHTML = ''

		const achievementsData = result.achievements
		const renderPromises = []

		for (const partType of Object.keys(achievementsData).sort())
			for (const partName of Object.keys(achievementsData[partType]).sort())
				renderPromises.push((async () => {
					const { info } = await getPartDetails(partType, partName)
					return renderTemplate('category_section', {
						category: info,
						achievements: achievementsData[partType][partName],
					})
				})())

		const categorySections = await Promise.all(renderPromises)
		categorySections.forEach(section => achievementsContainer.appendChild(section))
	} catch (error) {
		console.error('Failed to load achievements:', error)
		achievementsContainer.innerHTML = `<p class="text-error">${geti18n('achievements.error.load_failed', { message: error.message })}</p>`
	} finally {
		render_lock = false
	}
}

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
