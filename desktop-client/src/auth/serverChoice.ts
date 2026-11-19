/**
 * A client may have two addresses for the same server: the one used inside the office, and a remote one (through the gateway) for when the person
 * is away. The office address is tried first; the remote one is used only when the office address cannot be reached. Both reach the same server and
 * the same data, so a session works through either.
 */
export async function chooseServer(local: string, remote: string | undefined, reachable: (url: string) => Promise<boolean>): Promise<string> {
  if (!remote || remote === local) return local
  return (await reachable(local)) ? local : remote
}

/** Does this address answer the server's public meta endpoint quickly? */
export async function answers(url: string, fetchFn: typeof fetch = fetch, ms = 3000): Promise<boolean> {
  try { return (await fetchFn(`${url}/v1/meta`, { signal: AbortSignal.timeout(ms) })).ok } catch { return false }
}
