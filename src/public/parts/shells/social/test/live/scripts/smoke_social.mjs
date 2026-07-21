import { createShellProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const social = await createShellProbe('social')
const chat = await createShellProbe('chat')
const { testCase, writeLiveSection, completeLiveScript } = social

let entityHash = null

writeLiveSection('Social smoke')

await testCase('GET chat /viewer', async () => {
	const r = await chat.shellApi('GET', '/viewer')
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	entityHash = r.json.viewerEntityHash
	return Boolean(entityHash)
})

await testCase('POST /posts', async () => {
	const r = await social.shellApi('POST', '/posts', {
		entityHash,
		text: 'social smoke post',
		visibility: 'public',
		locale: 'zh-CN',
	})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return Boolean(r.json.event?.id)
})

await testCase('GET /feed', async () => {
	const r = await social.shellApi('GET', '/feed?limit=20')
	return r.status === 200 && r.json.items != null
})

completeLiveScript('SMOKE_SOCIAL')
