import { getUserDictionary } from '../../../server/auth.mjs'

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {string} events.jsonl 路径
 */
export function operatorTimelineEventsPath(username, entityHash) {
	return `${getUserDictionary(username)}/shells/social/timelines/${entityHash.toLowerCase()}/events.jsonl`
}
