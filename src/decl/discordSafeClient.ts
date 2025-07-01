import { Client as DiscordClient } from 'npm:discord.js'

/**
 * Creates a safe Discord client proxy that wraps event listeners with error handling
 * to prevent application crashes from unhandled errors in character implementations.
 */
export function createSafeDiscordClient(client: DiscordClient): DiscordClient {
  const handler = {
    get(target: any, prop: string | symbol, receiver: any) {
      if (prop === 'on' || prop === 'once') {
        return (event: string, listener: (...args: any[]) => void) => {
          const safeListener = async (...args: any[]) => {
            try {
              await listener(...args);
            } catch (error) {
              console.error(`[CharRuntime] Error in Discord event listener for event '${event}':`, error);
            }
          };
          return target[prop](event, safeListener);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(client, handler);
}