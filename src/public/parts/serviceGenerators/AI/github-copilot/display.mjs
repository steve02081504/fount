/* global sourceName, serviceSourcePath, cache, hosturl */
return options => import(`${hosturl}/parts/shells:oauth_handler/src/oauthDisplay.mjs`).then(({ renderOauthPanel }) =>
	renderOauthPanel({ ...options, provider: 'github-copilot', sourceName, serviceSourcePath, cache }))
