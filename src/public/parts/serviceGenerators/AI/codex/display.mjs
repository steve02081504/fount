/* global sourceName, serviceSourcePath, cache, hosturl */
return displayOptions => import(`${hosturl}/parts/shells:oauth_handler/src/oauthDisplay.mjs`).then(({ renderOauthPanel }) =>
	renderOauthPanel({ ...displayOptions, provider: 'openai-codex', sourceName, serviceSourcePath, cache }))
