/* global sourceName, serviceSourcePath, cache */
return displayOptions => import('/parts/shells:oauth_handler/src/oauthDisplay.mjs').then(({ renderOauthPanel }) =>
	renderOauthPanel({ ...displayOptions, provider: 'openai-codex', sourceName, serviceSourcePath, cache }))
