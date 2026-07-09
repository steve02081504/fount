import { channelKeyReducers } from './channel_keys.mjs'
import { channelReducers } from './channels.mjs'
import { fileReducers } from './files.mjs'
import { governanceReducers } from './governance.mjs'
import { memberReducers } from './members.mjs'
import { messageReducers } from './messages.mjs'
import { roleReducers } from './roles.mjs'
import { sessionReducers } from './sessions.mjs'
import { worldOpReducers } from './worldOps.mjs'

/** Chat 群 DAG 事件 reducer 表（物化用）。 */
export const CHAT_EVENT_REDUCERS = {
	...memberReducers,
	...roleReducers,
	...channelReducers,
	...channelKeyReducers,
	...messageReducers,
	...fileReducers,
	...governanceReducers,
	...sessionReducers,
	...worldOpReducers,
}
