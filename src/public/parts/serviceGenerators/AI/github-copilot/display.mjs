/* global sourceName, serviceSourcePath, cache */
return options => import('/parts/shells:oauth_handler/src/oauthDisplay.mjs').then(({ renderOauthPanel }) =>
	renderOauthPanel({ ...options, provider: 'github-copilot', sourceName, serviceSourcePath, cache }))
