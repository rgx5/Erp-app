import bcrypt from 'bcryptjs'

/** bcrypt hashing with a configurable cost. The dummy hash lets a login for an unknown user take as long as a real one. */
export class Passwords {
  private dummy: string

  constructor(private readonly cost: number) {
    this.dummy = bcrypt.hashSync('not-a-real-password', cost)
  }

  hash(plain: string): Promise<string> { return bcrypt.hash(plain, this.cost) }

  async verify(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) { await bcrypt.compare(plain, this.dummy); return false }
    return bcrypt.compare(plain, hash)
  }
}

/** Wrong-PIN / wrong-password lockout: free for four misses, then 30 s, doubling per further miss up to 15 minutes. */
export function lockoutSeconds(failures: number): number {
  if (failures < 5) return 0
  return Math.min(900, 30 * 2 ** (failures - 5))
}
