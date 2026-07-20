import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

import { resolveAgentCharPartName, scanLocalAgentEntitiesFromChars } from './member.mjs'

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {string | null} chars/ 目录名
 */
export function resolveAgentCharPartNameForUser(username, entityHash) {
	return resolveAgentCharPartName(username, entityHash, getUserDictionary, fs, path)
}

/**
 * @param {string} username replica
 * @returns {{ entityHash: string, charPartName: string }[]} 本地 agent
 */
export function listLocalAgentEntities(username) {
	return scanLocalAgentEntitiesFromChars(username, getUserDictionary, fs, path)
}
