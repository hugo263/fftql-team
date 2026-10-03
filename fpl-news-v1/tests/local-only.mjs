// Preload for the provider-stub test run. No real external fetch may leave this process.
const fetchLocal = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol === "data:") return fetchLocal(input, init);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`External network disabled during invariant tests: ${url.hostname}`);
  }
  return fetchLocal(input, init);
};
