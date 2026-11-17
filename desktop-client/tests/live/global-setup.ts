import type { TestProject } from 'vitest/node'
import { bootBackend } from '../backend-boot'

export interface Live { baseUrl: string; platformToken: string }
declare module 'vitest' {
  interface ProvidedContext { live: Live }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const backend = await bootBackend()
  project.provide('live', { baseUrl: backend.baseUrl, platformToken: backend.platformToken })
  return backend.stop
}
