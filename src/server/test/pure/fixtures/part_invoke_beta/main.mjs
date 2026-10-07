/* eslint-disable jsdoc/require-jsdoc */
export default {
	interfaces: {
		invokes: {
			ArgumentsHandler: async (_user, args) => args[0] === 'void' ? undefined : { type: 'output', content: args.join(' ') },
		},
	},
}
