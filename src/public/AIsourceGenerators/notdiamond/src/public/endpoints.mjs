// This file contains wrapper functions for API calls specific to the NotDiamond AI source generator.

export async function fetchNotDiamond(url, options) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    console.error('Error in fetchNotDiamond:', error);
    // Simulate a response object that would indicate an error to the caller
    // This helps maintain consistency with how fetch errors might be handled
    return {
      ok: false,
      status: 500, // Or another appropriate status code for a network/fetch error
      statusText: error.message || 'Network request failed',
      json: async () => ({ error: { message: error.message || 'Network request failed' } }),
      text: async () => error.message || 'Network request failed',
    };
  }
}
