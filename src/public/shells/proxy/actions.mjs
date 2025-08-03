import { hosturl } from '../../../server/server.mjs'

export const actions = {
	default: ({ user }) => `${hosturl}/asuser/${user}/api/shells/proxy/calling/openai`
}
