import { locale_t, timeStamp_t } from './basedefs.ts';
import { AIsource_t } from './AIsource.ts';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts';

export class pluginAPI_t {
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
	Init: () => void;
	Load: () => void;
	Unload: (reason: string) => void;
	Uninstall: (reason: string, from: string) => void;

	SetAISource: (source: AIsource_t<any, any>, type: string) => void;
	GetAISource: (type: string) => AIsource_t<any, any>;
	AISourceTypes: { name: string; type: string }[];

	interfacies: {
		chat: {
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			RepalyHandler: (repaly: chatLogEntry_t, functions: {
				addLongTimeLog?: (entry: chatLogEntry_t) => void
			}) => Promise<boolean>
		}
	};
}
