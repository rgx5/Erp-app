import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm, type DefaultValues, type FieldValues, type UseFormRegister, type FieldErrors } from 'react-hook-form'
import type { z } from 'zod'
import { showApiError } from '@/features/setup/forms'
import { Alert, Button } from './primitives'

/** A form that validates with a zod schema, sends through `submit`, maps server field errors onto its fields and shows one message for the rest. */
export function SimpleForm<S extends z.ZodType<FieldValues, FieldValues>>({ schema, defaults, fields, submit, label, children }: {
  schema: S
  defaults: DefaultValues<z.infer<S>>
  fields: readonly string[]
  submit: (values: z.infer<S>) => Promise<unknown>
  label: string
  children: (api: { register: UseFormRegister<z.infer<S>>; errors: FieldErrors<z.infer<S>> }) => ReactNode
}) {
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<z.infer<S>>({ resolver: zodResolver(schema as never), defaultValues: defaults })
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await submit(v); reset(defaults) } catch (e) { setMessage(showApiError(e, setError, fields)) }
    })}>
      {children({ register, errors })}
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={isSubmitting}>{label}</Button>
    </form>
  )
}
