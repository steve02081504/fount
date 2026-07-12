/** fount 域的本地化/展示工具门面，供 chat/social shell 引用。 */
export {
	localesFromRequest,
	getInfoDefaultsForEntity,
	isPlaceholderDisplayName,
} from './presentation.mjs'

/**
 *
 */
export {
	normalizeLocalizedMap,
	applyAvatarToAllLocales,
} from 'npm:@steve02081504/fount-p2p/entity/localized_core'
