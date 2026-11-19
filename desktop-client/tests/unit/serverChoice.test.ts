import { describe, expect, it } from 'vitest'
import { answers, chooseServer } from '@/auth/serverChoice'

describe('office address first, remote address as the fallback', () => {
  const office = 'https://onesync.local'; const remote = 'https://pune.remote.example.in'
  it('uses the office address when it answers', async () => { expect(await chooseServer(office, remote, async () => true)).toBe(office) })
  it('uses the remote address only when the office one cannot be reached', async () => { expect(await chooseServer(office, remote, async (u) => u !== office)).toBe(remote) })
  it('uses the office address when there is no remote one, even if it is down', async () => { expect(await chooseServer(office, undefined, async () => false)).toBe(office); expect(await chooseServer(office, office, async () => false)).toBe(office) })
  it('asks the public meta endpoint, and treats errors and bad answers as unreachable', async () => {
    const seen: string[] = []
    expect(await answers(office, (async (u: string) => { seen.push(u); return { ok: true } }) as unknown as typeof fetch)).toBe(true)
    expect(seen).toEqual([`${office}/v1/meta`])
    expect(await answers(office, (async () => ({ ok: false })) as unknown as typeof fetch)).toBe(false)
    expect(await answers(office, (async () => { throw new Error('no route') }) as unknown as typeof fetch)).toBe(false)
  })
})
