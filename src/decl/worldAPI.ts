import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

export class WorldAPI_t {
	info: info_t
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init?: (stat: {
		username: string,
		worldname: string,
	}) => Promise<void>
	// calls on every start, pop a message if fail
	Load?: (stat: {
		username: string,
		worldname: string,
	}) => Promise<void>
	// calls on every unload
	Unload?: (reason: string) => Promise<void>
	// calls on uninstall
	Uninstall?: (reason: string, from: string) => Promise<void>

	interfaces?: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		chat?: {
			GetGreeting?: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetGroupGreeting?: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetChatLogForCharname?: (arg: chatReplyRequest_t, charname: string) => Promise<chatLogEntry_t[]>
			AddChatLogEntry?: (arg: chatReplyRequest_t, entry: chatLogEntry_t) => Promise<void>
			AfterAddChatLogEntry?: (arg: chatReplyRequest_t, freq_data: {
				charname: null;
				frequency: number;
			}[]) => Promise<void>
			GetCharReply?: (arg: chatReplyRequest_t, charname: string) => Promise<chatReply_t | null>
			MessageEdit?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditing?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			MessageDelete?: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		}
	}
}
