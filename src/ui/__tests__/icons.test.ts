import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `tsc` only checks the icon *types*; Metro needs the runtime file. A path with types but no file breaks the whole bundle. */
test('every icon in the registry exists as a runtime module', () => {
  const src = readFileSync(join(__dirname, '..', 'icons.ts'), 'utf8')
  const names = [...src.matchAll(/lucide-react-native\/icons\/([\w-]+)'/g)].map((m) => m[1])
  expect(names.length).toBeGreaterThan(100)
  const missing = names.filter((n) => !existsSync(join(__dirname, '../../../node_modules/lucide-react-native/dist/esm/icons', `${n}.mjs`)))
  expect(missing).toEqual([])
})
