export function getCharacterSource(charData) {
	if (!charData) return ''
	const chubId = charData?.data?.extensions?.chub?.full_path
	if (chubId)
		return `https://chub.ai/characters/${chubId}`

	const pygmalionId = charData?.data?.extensions?.pygmalion_id
	if (pygmalionId)
		return `https://pygmalion.chat/${pygmalionId}`

	const githubRepo = charData?.data?.extensions?.github_repo
	if (githubRepo)
		return `https://github.com/${githubRepo}`

	const sourceUrl = charData?.data?.extensions?.source_url
	if (sourceUrl)
		return sourceUrl

	const risuId = charData?.data?.extensions?.risuai?.source
	if (Array.isArray(risuId) && risuId.length && Object(risuId[0]) instanceof String && risuId[0].startsWith('risurealm:')) {
		const realmId = risuId[0].split(':')[1]
		return `https://realm.risuai.net/character/${realmId}`
	}

	return ''
}
