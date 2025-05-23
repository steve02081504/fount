// This file contains wrapper functions for API calls specific to the DuckDuckGo AI source generator.

export async function getDuckDuckGoStatus(headers) {
  try {
    const response = await fetch('https://duckduckgo.com/duckchat/v1/status', {
      method: 'GET',
      headers,
    });
    return response;
  } catch (error) {
    console.error('Error fetching DuckDuckGo status:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    return {
      ok: false,
      status: 500, // Internal Server Error
      json: async () => ({ message: 'Failed to fetch due to network or server error' })
    };
  }
}

export async function postDuckDuckGoChat(headers, body) {
  try {
    const response = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
      method: 'POST',
      headers,
      body, // body is already a string
    });
    return response;
  } catch (error) {
    console.error('Error posting to DuckDuckGo chat:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    return {
      ok: false,
      status: 500, // Internal Server Error
      // The original code expects to read the response as text for streaming
      text: async () => 'Failed to fetch due to network or server error'
    };
  }
}
