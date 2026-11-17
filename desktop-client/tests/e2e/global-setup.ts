import { bootBackend } from '../backend-boot'

export default async function setup(): Promise<() => Promise<void>> {
  const backend = await bootBackend()
  process.env['E2E_BACKEND_URL'] = backend.baseUrl
  process.env['E2E_PLATFORM_TOKEN'] = backend.platformToken
  return backend.stop
}
