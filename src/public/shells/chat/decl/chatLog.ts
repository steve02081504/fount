import { locale_t, role_t, timeStamp_t } from '../../../../decl/basedefs.ts';
import { charAPI_t } from '../../../../decl/charAPI.ts';
import { WorldAPI_t } from '../../../../decl/WorldAPI.ts';
import { UserAPI_t } from '../../../../decl/UserAPI.ts';
import { pluginAPI_t } from '../../../../decl/PluginAPI.ts';

export class chatReply_t {
	name?: string;
	avatar?: string;
	content: string;
	content_for_edit?: string;
	files?: {
		name: string;
		mimeType: string;
		buffer: Buffer;
		description: string;
	}[]
	logContextBefore?: chatLogEntry_t[];
	logContextAfter?: chatLogEntry_t[];
	extension?: any;
}

export class chatReplyRequest_t {
	chat_id: string
	username: string
	Charname: string
	UserCharname: string
	ReplyToCharname?: string
	locale: locale_t // 常见用法：switch (args.locale.split('-')[0]) 来多语言info或开场白
	time: timeStamp_t
	chat_log: chatLogEntry_t[]
	AddChatLogEntry: (entry: chatReply_t) => Promise<chatLogEntry_t> // 调用这个来主动或定时发信息
	Update: () => Promise<chatReplyRequest_t> // 调用这个来在定时任务时获取最新args
	world: WorldAPI_t
	user: UserAPI_t
	char: charAPI_t
	other_chars: Record<string, charAPI_t>
	plugins: pluginAPI_t[]
	chat_summary: string
	chat_scoped_char_memory: {}
}

export class chatLogEntry_t {
	name: string;
	avatar: string;
	timeStamp: timeStamp_t;
	role: role_t;
	content: string;
	content_for_edit?: string;
	files: {
		name: string;
		mimeType: string;
		buffer: Buffer;
		description: string;
	}[]
	logContextBefore: chatLogEntry_t[] // 内容会被展开到此信息前
	logContextAfter: chatLogEntry_t[] // 展开到其后
	extension: {
		timeSlice: {
			chars: Map<string, charAPI_t>;
			summary: string;
			world: WorldAPI_t;
			player: UserAPI_t;
		}
	};
}
export type chatLog_t = chatLogEntry_t[];
