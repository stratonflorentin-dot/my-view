export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureWorkerStarted } = await import("./lib/pipeline/worker");
    ensureWorkerStarted();
  }
}
