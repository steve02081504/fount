export async function startDiscordBot(botname) {
	const response = await fetch('/api/shells/discordbot/start', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ botname }),
	})

	if (!response.ok)
		throw new Error(`API request failed with status ${response.status}`)

	return response.json()
}

export async function getDiscordBotList() {
	const response = await fetch('/api/shells/discordbot/getbotlist', {
		method: 'POST',
	})

	if (!response.ok)
		throw new Error(`API request failed with status ${response.status}`)

	return response.json()
}
