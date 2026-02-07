import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../../scripts/i18n.mjs'
import { generateApiKey, revokeApiKey } from '../../../../../server/auth.mjs' // Import generateApiKey and revokeApiKey
import { StartJob, EndJob } from '../../../../../server/jobs.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { hosturl } from '../../../../../server/server.mjs'
import { sendEventToAll } from '../../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs' // Import unlockAchievement

const runningPets = {} // { [username]: { [charname]: { webview, apiKeyJti } } }

/**
 * 运行宠物。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function runPet(username, charname) {
	if (runningPets[username]?.[charname]) return

	StartJob(username, 'shells/deskpet', charname)

	try {
		const char = await loadPart(username, 'chars/' + charname)
		if (!char.interfaces.deskpet) {
			const { createDefaultDeskpetInterface } = await import('./default_interface/main.mjs')
			char.interfaces.deskpet = await createDefaultDeskpetInterface(char, username, charname)
		}
		const petConfig = await char.interfaces.deskpet.GetPetConfig()

		if (!petConfig || !petConfig.url)
			throw new Error(`Character ${charname} does not provide a valid pet URL.`)


		const originalPetUrl = petConfig.url

		// Generate a temporary API key for the webview
		const { apiKey, jti } = await generateApiKey(username, `DeskPet-${charname}-temp-key`)

		const intermediatePageUrl = `${hosturl}/parts/shells:deskpet/set_cookie_and_redirect.html`
		const encodedOriginalPetUrl = encodeURIComponent(originalPetUrl)
		const encodedApiKey = encodeURIComponent(apiKey)

		const finalUrl = `${intermediatePageUrl}?apikey=${encodedApiKey}&redirect=${encodedOriginalPetUrl}`

		const { WebUI } = await import('jsr:@webui/deno-webui')

		const myWindow = new WebUI()

		myWindow.bind('minimize', () => {
			myWindow.minimize()
		})
		myWindow.bind('close_win', () => {
			WebUI.exit()
		})

		myWindow.setSize(petConfig.windowOptions?.width ?? 400, petConfig.windowOptions?.height ?? 400)
		myWindow.setFrameless(petConfig.windowOptions?.frameless ?? true)
		myWindow.setTransparent(petConfig.windowOptions?.transparent ?? true)
		myWindow.setResizable(false)

		myWindow.show(finalUrl).then(async () => {
			delete runningPets[username][charname]
			if (!Object.keys(runningPets[username]).length) delete runningPets[username]

			await revokeApiKey(jti)
			EndJob(username, 'shells/deskpet', charname)
			sendEventToAll('deskpet-list-updated')
		})

		runningPets[username] ??= {}
		runningPets[username][charname] = { webview: myWindow, apiKeyJti: jti }
		sendEventToAll('deskpet-list-updated')
		unlockAchievement(username, 'shells/deskpet', 'start_deskpet') // Trigger achievement here
	} catch (error) {
		console.error(`[DeskPet] Failed to start pet for ${charname}:`, error)
		EndJob(username, 'shells/deskpet', charname) // End job on failure
	}
}

/**
 * 停止宠物。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function stopPet(username, charname) {
	const petInfo = runningPets[username]?.[charname]
	if (petInfo) {
		delete runningPets[username][charname]
		if (!Object.keys(runningPets[username]).length)
			delete runningPets[username]

		petInfo.webview.destroy()

		// Revoke the API key
		await revokeApiKey(petInfo.apiKeyJti)

		EndJob(username, 'shells/deskpet', charname)
		sendEventToAll('deskpet-list-updated')
	}
	else
		console.log(`[DeskPet] No running pet found for ${charname} by user ${username} to stop.`)
}

/**
 * 暂停宠物（停止运行但不从 config 中移除，以便 PauseAllJobs 后可通过 ReStartJobs 恢复）。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function pausePet(username, charname) {
	const petInfo = runningPets[username]?.[charname]
	if (!petInfo) return

	delete runningPets[username][charname]
	if (!Object.keys(runningPets[username]).length)
		delete runningPets[username]

	petInfo.webview.destroy()
	await revokeApiKey(petInfo.apiKeyJti)
	sendEventToAll('deskpet-list-updated')
}
on_shutdown(async () => {
	for (const username of Object.keys(runningPets))
		for (const charname of [...Object.keys(runningPets[username] ?? {})])
			await pausePet(username, charname).catch(console.error)
})

/**
 * 获取正在运行的宠物。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 正在运行的宠物列表。
 */
export function getRunningPets(username) {
	if (!runningPets[username]) return []
	return Object.keys(runningPets[username])
}

