import { get_hosturl_in_local_ip } from '../../../../scripts/ratelimit.mjs'

export const actions = {
	default: () => get_hosturl_in_local_ip()
}
