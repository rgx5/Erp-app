// Bundles the server (and the shared app code it imports) into dist/. esbuild resolves the `@/*` → ../src/* paths.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
await build({
  entryPoints: { main: join(root, 'src/main.ts'), migrate: join(root, 'src/migrate-cli.ts') },
  outdir: join(root, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  tsconfig: join(root, 'tsconfig.json'),
  external: ['pg-native'],
  logLevel: 'info',
})
