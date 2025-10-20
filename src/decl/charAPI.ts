import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js'
import { Telegraf } from 'npm:telegraf'

import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { info_t, locale_t, role_t, timeStamp_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'


export class charState_t {
	init_count: number
	start_count: number
	last_start_time_stamp: timeStamp_t
}

export class charInit_t {
	state: charState_t
	username: string
	charname: string
}

export class CharAPI_t {
	info: info_t
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init?: (stat: charInit_t) => Promise<void>
	// calls on every char start, pop a message if fail
	Load?: (stat: charInit_t) => Promise<void>
	// calls on every char unload
	Unload?: (reason: string) => Promise<void>
	// calls on char uninstall
	Uninstall?: (reason: string, from: string) => Promise<void>

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		chat?: {
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetPromptForOther: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetReply: (arg: chatReplyRequest_t) => Promise<chatReply_t | null>
			GetReplyFrequency?: (arg: chatReplyRequest_t) => Promise<number>
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
		},
		discord?: {
			Intents?: DiscordGatewayIntentBits[]
			Partials?: DiscordPartials[]
			OnceClientReady: (client: DiscordClient, config: any) => Promise<void>
			GetBotConfigTemplate: () => Promise<any>
		},
		telegram?: {
			BotSetup?: (bot: Telegraf, config: any) => Promise<void>;
			GetBotConfigTemplate?: () => Promise<any>;
		},
		browserIntegration?: {
			BrowserJsCallback: (arg: { data: any, pageId: number, script: string }) => Promise<void>;
		},
		shellassist?: {
			Assist: (data: {
				username: string
				UserCharname: string
				shelltype: string
				shellhistory: ({
					command: string
					output: string
					error: string
					time: timeStamp_t
				} | {
					role: role_t
					content: string
				})[]
				pwd: string
				command_now: string
				command_output: string
				command_error: string
				rejected_commands: string[]
				chat_scoped_char_memory: object
			}) => Promise<{
				name: string
				avatar: string
				recommend_command: string
				content: string
				chat_scoped_char_memory: object
			}>
		},
		deskpet?: {
			GetPetConfig: () => Promise<{
				/**
				 * The URL to load in the webview.
				 * This can be a remote URL (https://...), a local file path, or a data URI.
				 * The URL will be resolved relative to the fount server address.
				 */
				url: string;

				/**
				 * Options for the webview window.
				 */
				windowOptions?: {
					width?: number;
					height?: number;
					frameless?: boolean;
					transparent?: boolean;
					/**
					 * Window resizing hint.
					 * "none": No hint.
					 * "fixed": Fixed window size.
					 * "min": Minimum window size.
					 * "max": Maximum window size.
					 */
					hint?: 'none' | 'fixed' | 'min' | 'max';
				};
			}>;
		}
	}
}
