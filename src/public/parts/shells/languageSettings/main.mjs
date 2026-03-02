const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 语言设置Shell
 */
export default {
	info,
	interfaces: {
		web: {},
	}
}
