/* global sourceName, serviceSourcePath, cache */
const { renderOauthPanel } = await import('/parts/shells:oauth_handler/src/oauthDisplay.mjs')
return args => renderOauthPanel({ ...args, provider: 'openai-codex', sourceName, serviceSourcePath, cache })
