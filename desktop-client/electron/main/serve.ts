import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'onesync'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
}

/**
 * Maps an `app://onesync/<path>` URL to a file under `root`, falling back to index.html for client-side routes. Returns null for a
 * path that would leave `root` (traversal) so the caller answers 403.
 */
export async function resolveAppFile(root: string, url: string): Promise<{ path: string; type: string } | null> {
  const { pathname } = new URL(url)
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const candidate = join(root, relative)
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  const isFile = await stat(candidate).then((s) => s.isFile(), () => false)
  // Anything that looks like an asset but is missing is a real 404; only extension-less routes fall back to the app shell.
  const path = isFile ? candidate : extname(relative) === '' ? join(root, 'index.html') : candidate
  return { path, type: MIME[extname(path)] ?? 'application/octet-stream' }
}

export async function readAppFile(file: { path: string; type: string }): Promise<Response> {
  try {
    return new Response(new Uint8Array(await readFile(file.path)), { headers: { 'content-type': file.type, 'cache-control': 'no-store' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
