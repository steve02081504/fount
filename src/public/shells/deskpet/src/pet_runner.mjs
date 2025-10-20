import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../scripts/i18n.mjs'
import { generateApiKey, revokeApiKey } from '../../../../server/auth.mjs' // Import generateApiKey and revokeApiKey
import { StartJob, EndJob } from '../../../../server/jobs.mjs'
import { LoadChar } from '../../../../server/managers/char_manager.mjs'
import { hosturl } from '../../../../server/server.mjs'
import { sendEventToAll } from '../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs' // Import unlockAchievement

const runningPets = {} // { [username]: { [charname]: { webview, apiKeyJti } } }

export async function runPet(username, charname) {
	if (runningPets[username]?.[charname]) return

	StartJob(username, 'shells', 'deskpet', charname)

	try {
		const char = await LoadChar(username, charname)
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

		const intermediatePageUrl = `${hosturl}/shells/deskpet/set_cookie_and_redirect.html`
		const encodedOriginalPetUrl = encodeURIComponent(originalPetUrl)
		const encodedApiKey = encodeURIComponent(apiKey)

		const finalUrl = `${intermediatePageUrl}?apikey=${encodedApiKey}&redirect=${encodedOriginalPetUrl}`

		const { WebView } = await import('https://deno.land/x/webview/mod.ts')
		const webview = new WebView({
			title: charname,
			url: finalUrl,
			width: petConfig.windowOptions?.width ?? 400,
			height: petConfig.windowOptions?.height ?? 400,
			frameless: petConfig.windowOptions?.frameless ?? true,
			transparent: petConfig.windowOptions?.transparent ?? true,
		})
			; (async () => {
			await webview.run()
			if (runningPets[username]?.[charname]) {
				delete runningPets[username][charname]
				if (!Object.keys(runningPets[username]).length)
					delete runningPets[username]

				// Revoke the API key
				await revokeApiKey(jti)
				EndJob(username, 'shells', 'deskpet', charname)
				sendEventToAll('deskpet-list-updated')
			}
		})()

		if (!runningPets[username])
			runningPets[username] = {}

		runningPets[username][charname] = { webview, apiKeyJti: jti }
		sendEventToAll('deskpet-list-updated')
		unlockAchievement(username, 'shells', 'deskpet', 'start_deskpet') // Trigger achievement here

	} catch (error) {
		console.error(`[DeskPet] Failed to start pet for ${charname}:`, error)
		EndJob(username, 'shells', 'deskpet', charname) // End job on failure
	}
}

export async function stopPet(username, charname) {
	const petInfo = runningPets[username]?.[charname]
	if (petInfo) {
		delete runningPets[username][charname]
		if (!Object.keys(runningPets[username]).length)
			delete runningPets[username]

		petInfo.webview.destroy()

		// Revoke the API key
		await revokeApiKey(petInfo.apiKeyJti)

		EndJob(username, 'shells', 'deskpet', charname)
		console.log(`[DeskPet] Pet for ${charname} stopped.`)
		sendEventToAll('deskpet-list-updated')
	}
	else
		console.log(`[DeskPet] No running pet found for ${charname} by user ${username} to stop.`)
}

export function getRunningPets(username) {
	if (!runningPets[username]) return []
	return Object.keys(runningPets[username])
}

// Graceful shutdown
on_shutdown(async () => {
	for (const username in runningPets)
		for (const charname in runningPets[username])
			await stopPet(username, charname)
})
