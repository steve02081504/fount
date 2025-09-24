import { hosturl } from '../../../../server/server.mjs'

export const actions = {
	default: ({ user }) => `${hosturl}/api/shells/proxy/calling/openai`
}
