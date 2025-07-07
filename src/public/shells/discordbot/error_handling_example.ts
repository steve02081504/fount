/**
 * Example implementation showing proper error handling for Discord bot login
 * This demonstrates how to implement the error handling around the login call
 * as specified in the final_solution_plan
 */

import { CharAPI_t } from '../../../decl/charAPI.ts'

/**
 * Example function showing how to properly handle Discord bot login with error handling
 * This should be implemented in the actual Discord bot shell code
 */
async function handleDiscordBotLogin(charAPI: CharAPI_t, token: string): Promise<void> {
  // Check if the character has Discord interface
  if (!charAPI.interfaces.discord?.login) {
    throw new Error('Discord interface not available for this character');
  }

  try {
    // Call the login function from the discord interface
    await charAPI.interfaces.discord.login(token);
    console.log('Discord bot logged in successfully');
  } catch (error) {
    // Handle the specific case of invalid token errors
    console.error("Invalid Discord bot token. Please update bot_configs.json.", error);
    
    // Additional error handling based on error type
    if (error instanceof Error) {
      if (error.message.includes('Invalid status code 400') || 
          error.message.includes('readyState') || 
          error.message.includes('Invalid Token')) {
        // This handles the specific errors seen in the issue:
        // - NetworkError: failed to connect to WebSocket: Invalid status code 400 Bad Request
        // - InvalidStateError: 'readyState' not OPEN
        throw new Error('Discord bot authentication failed. Please verify the bot token in bot_configs.json is correct and has not expired.');
      }
    }
    
    // Re-throw the error for higher-level handling
    throw error;
  }
}

export { handleDiscordBotLogin };