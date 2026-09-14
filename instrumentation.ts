export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEngine } = await import('./server/engine');
    void getEngine().ready.catch(error => console.error('Model initialization:', error.message));
  }
}
