import { events } from '../../../../../../../server/events.mjs'

import { invalidateAllFederationPartitionsForUser } from './registry.mjs'

/**
 * @param {string} username 用户名
 * @returns {void}
 */
export function invalidateAllFederationRoomsForUser(username) {
	invalidateAllFederationPartitionsForUser(username)
}

events.on('federation-settings-changed', ({ username }) => {
	invalidateAllFederationRoomsForUser(username)
	void import('../stream/signing.mjs')
		.then(module => module.invalidateStreamSignerCache(username))
		.catch(error => console.warn('federation: invalidateStreamSignerCache failed', error))
})

/**
 *
 */
export {
	ensureFederationDefaults,
	ensureNodeIdentityPubKey,
	getFederationIdentitySecret,
	getFederationSettings,
	saveFederationSettings,
} from '../../../../../../../scripts/p2p/federation/identity.mjs'
