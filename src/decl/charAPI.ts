import { locale_t, role_t, timeStamp_t } from './basedefs.ts';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts';

import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js';

export class charState_t {
	InitCount: number;
	StartCount: number;
	LastStart: timeStamp_t;
}

export class charInit_t {
	state: charState_t;
	username: string;
	charname: string;
}

export class charAPI_t {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init: (stat: charInit_t) => void;
	// calls on every char start, pop a message if fail
	Load: (stat: charInit_t) => void;
	// calls on every char unload
	Unload: (reason: string) => void;
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => void;

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfaces: {
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
			GetReplyFequency?: (arg: chatReplyRequest_t) => Promise<number>
			MessageEdit?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditting?: (arg: {
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
			OnceClientReady: (client: DiscordClient, config: any) => void
			GetBotConfigTemplate: () => Promise<any>
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
				command_error: string
				rejected_commands: string[]
				chat_scoped_char_memory: {}
			}) => Promise<{
				name: string
				avatar: string
				recommend_command: string
				content: string
				chat_scoped_char_memory: {}
			}>
		}
	};
}
