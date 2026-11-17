import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/api/errors'

/** Puts the server's per-field messages on the form and returns whatever is left to show as one message above the button. */
export function showApiError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string | null {
  if (err instanceof ApiError) {
    const fieldMap = err.fieldMap()
    let used = 0
    for (const [path, message] of Object.entries(fieldMap)) {
      if (fields.includes(path)) { setError(path as Path<T>, { type: 'server', message }); used++ }
    }
    if (used > 0 && used === Object.keys(fieldMap).length) return null
    return err.requestId ? `${err.message} (reference ${err.requestId})` : err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}
