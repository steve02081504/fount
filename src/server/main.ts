try {
  await import('./index.mjs');
} catch (error) {
  console.error('Error in server:', error);
  Deno.exit(1);
}