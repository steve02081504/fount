// This file contains wrapper functions for API calls specific to the Claude AI source generator.

export async function getOrganizations(rProxy, headers) {
  try {
    const response = await fetch(`${rProxy}/api/organizations`, {
      method: 'GET',
      headers,
    });
    return response;
  } catch (error) {
    console.error('Error fetching organizations:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    return {
      ok: false,
      status: 500, // Internal Server Error
      json: async () => ({ error: { message: 'Failed to fetch due to network or server error' } })
    };
  }
}

export async function postCompletion(rProxy, uuidOrg, conversationUuid, headers, payload) {
  try {
    const response = await fetch(`${rProxy}/api/organizations/${uuidOrg}/chat_conversations/${conversationUuid}/completion`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: payload.signal,
    });
    return response;
  } catch (error) {
    console.error('Error posting completion:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    // In this case, the original code expects to be able to read the error from the body,
    // so we need to provide a text() method.
    return {
      ok: false,
      status: 500, // Internal Server Error
      text: async () => JSON.stringify({ error: { message: 'Failed to fetch due to network or server error' } })
    };
  }
}
