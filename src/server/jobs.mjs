import { getUserByUsername, getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { loadPart } from './managers/index.mjs'
import { events } from './events.mjs'
import { geti18n } from '../scripts/i18n.mjs'

export function StartJob(username, parttype, partname, uid, data = null) {
	const jobs = getUserByUsername(username).jobs ??= {}
	jobs[parttype] ??= {}
	jobs[parttype][partname] ??= {}
	jobs[parttype][partname][uid] = data
	try {
		save_config()
	}
	catch (err) {
		console.error(err)
		EndJob(username, parttype, partname, uid)
	}
}
export function EndJob(username, parttype, partname, uid) {
	const jobs = getUserByUsername(username).jobs ??= {}
	if (jobs?.[parttype]?.[partname]?.[uid] !== undefined) {
		delete jobs[parttype][partname][uid]
		if (Object.keys(jobs[parttype][partname]).length === 0) {
			delete jobs[parttype][partname]
			if (Object.keys(jobs[parttype]).length === 0)
				delete jobs[parttype]
		}
		save_config()
	}
	else {
		console.warn('Job not found:', { username, parttype, partname, uid })
		throw new Error('Job not found')
	}
}
async function startJobsOfUser(username) {
	const jobs = getUserByUsername(username).jobs ?? {}
	for (const parttype in jobs)
		for (const partname in jobs[parttype])
			for (const uid in jobs[parttype][partname])
				try {
					console.log(await geti18n('fountConsole.jobs.restartingJob', { username, parttype, partname, uid }))
					const part = await loadPart(username, parttype, partname)
					await part.interfaces.jobs.ReStartJob(username, jobs[parttype][partname][uid] ?? uid)
				} catch (err) {
					console.error(err)
				}
}
export async function ReStartJobs() {
	await Promise.all(getAllUserNames().map(startJobsOfUser))
}

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	await startJobsOfUser(newUsername)
})
