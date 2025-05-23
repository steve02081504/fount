// This file contains wrapper functions for API calls specific to the Proxy AI source generator.

export async function postToProxy(url, options) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    console.error('Error in postToProxy:', error);
    // Simulate a response object that would indicate an error to the caller
    return {
      ok: false,
      status: 500, // Or another appropriate status code for a network/fetch error
      statusText: error.message || 'Network request failed',
      json: async () => ({ error: { message: error.message || 'Network request failed' } }),
      text: async () => error.message || 'Network request failed',
    };
  }
}
