const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Short, sortable, human-readable id. Prefixed so ids are self-describing in exports. Generated on the device so a
 *  record has its id before it ever reaches the server and syncing is a plain upsert. */
export function id(prefix: string, now = Date.now(), rnd: () => number = Math.random): string {
  let t = now
  let out = ''
  for (let i = 0; i < 8; i++) { out = ALPHABET[t % 32] + out; t = Math.floor(t / 32) }
  let rand = ''
  for (let i = 0; i < 4; i++) rand += ALPHABET[Math.floor(rnd() * 32)]
  return `${prefix}_${out}${rand}`
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0')
