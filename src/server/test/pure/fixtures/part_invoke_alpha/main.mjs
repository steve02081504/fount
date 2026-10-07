/* eslint-disable jsdoc/require-jsdoc */
export default {
	interfaces: {
		invokes: {
			ArgumentsHandler: async (_user, args) => ({ type: 'run-js', module: 'cli/run.mjs', args, data: { source: 'alpha' } }),
		},
	},
}
