async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `${geti18n('discord_bots.alerts.httpError')}! status: ${response.status}`)
	}
	return response.json()
}

export async function getBotList() {
	return fetchDataWithHandling('/api/shells/discordbot/getbotlist')
}

export async function getBotConfig(botname) {
	return fetchDataWithHandling(`/api/shells/discordbot/getbotconfig?botname=${encodeURIComponent(botname)}`)
}

export async function setBotConfig(botname, config) {
	return fetchDataWithHandling('/api/shells/discordbot/setbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname, config }),
	})
}

export async function deleteBotConfig(botname) {
	return fetchDataWithHandling('/api/shells/discordbot/deletebotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

export async function newBotConfig(botname) {
	return fetchDataWithHandling('/api/shells/discordbot/newbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

export async function startBot(botname) {
	return fetchDataWithHandling('/api/shells/discordbot/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

export async function stopBot(botname) {
	return fetchDataWithHandling('/api/shells/discordbot/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

export async function getRunningBotList() {
	return fetchDataWithHandling('/api/shells/discordbot/getrunningbotlist')
}

export async function getBotConfigTemplate(charname) {
	return fetchDataWithHandling(`/api/shells/discordbot/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`)
}
