import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  employee, page, payComponent, payrollInput, payrollLiabilities, payrollRules, payrollRun, payrollRunHeader, payrollSeed, payrollSettings, payslip, remittance, salaryStructure,
  type Employee, type PayComponent, type PayrollInput, type PayrollLiabilities, type PayrollRules, type PayrollRun, type PayrollSettings, type Payslip, type SalaryStructure,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> =>
  currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)
const P = '/v1/payroll'

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['payroll', 'journals', 'trial-balance', 'accounts', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
function useList<H>(key: unknown[], enabled: boolean, load: (cursor: string | undefined) => Promise<{ items: H[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({ queryKey: ['payroll', ...key], enabled, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => load(pageParam), getNextPageParam: (last) => last.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as H[]) }
}

export const usePayrollSettings = (companyId: string | undefined) => useQuery({ queryKey: ['payroll', 'settings', companyId], enabled: Boolean(companyId), queryFn: (): Promise<PayrollSettings> => get(`${P}/companies/{companyId}/settings`, { path: { companyId } }, payrollSettings) })
export const useSavePayrollSettings = (companyId: string) => useWrite((b: Record<string, string | null>) => send('PUT', `${P}/companies/${companyId}/settings`, b, payrollSettings))
export const usePayrollRules = (companyId: string | undefined, date: string, stateCode?: string) =>
  useQuery({ queryKey: ['payroll', 'rules', companyId, date, stateCode], enabled: Boolean(companyId), queryFn: (): Promise<PayrollRules> => get(`${P}/rules`, { query: query({ companyId: companyId as string, date, ...(stateCode ? { stateCode } : {}) }) }, payrollRules) })
export const useSeedPayrollRules = () => useWrite(({ companyId, effectiveFrom }: { companyId: string; effectiveFrom: string }) => send('POST', `${P}/rules/seed-defaults?companyId=${companyId}&effectiveFrom=${effectiveFrom}`, {}, payrollSeed))

export const useComponents = (companyId: string | undefined) => useQuery({ queryKey: ['payroll', 'components', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<PayComponent[]> => (await get(`${P}/components`, { query: query({ companyId: companyId as string }) }, z.object({ items: z.array(payComponent) }))).items })
export const useCreateComponent = () => useWrite((b: Record<string, unknown>) => send('POST', `${P}/components`, b, payComponent))
export const useUpdateComponent = () => useWrite(({ id, body }: { id: string; body: Record<string, unknown> }) => send('PATCH', `${P}/components/${id}`, body, payComponent))

export const useEmployees = (companyId: string | undefined, status?: string) =>
  useList(['employees', companyId, status], Boolean(companyId), (cursor) => get(`${P}/employees`, { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}) }) }, page(employee)))
export const useCreateEmployee = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${P}/employees`, body, employee, key))
export const useUpdateEmployee = () => useWrite(({ id, body }: { id: string; body: Record<string, unknown> }) => send('PATCH', `${P}/employees/${id}`, body, employee))
export const useExitEmployee = () => useWrite(({ id, dateOfLeaving }: { id: string; dateOfLeaving: string }) => send('POST', `${P}/employees/${id}/exit`, { dateOfLeaving }, employee))
export const useStructures = (employeeId: string | undefined) => useQuery({ queryKey: ['payroll', 'structures', employeeId], enabled: Boolean(employeeId), queryFn: async (): Promise<SalaryStructure[]> => (await get(`${P}/employees/{id}/structures`, { path: { id: employeeId } }, z.object({ items: z.array(salaryStructure) }))).items })
export const useAddStructure = (employeeId: string) => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${P}/employees/${employeeId}/structures`, body, salaryStructure, key))
export const usePayslips = (employeeId: string | undefined) => useQuery({ queryKey: ['payroll', 'payslips', employeeId], enabled: Boolean(employeeId), queryFn: async (): Promise<Payslip[]> => (await get(`${P}/employees/{id}/payslips`, { path: { id: employeeId } }, z.object({ items: z.array(payslip) }))).items })
export const useInputs = (companyId: string | undefined, period: string) => useQuery({ queryKey: ['payroll', 'inputs', companyId, period], enabled: Boolean(companyId && /^\d{4}-\d{2}$/.test(period)), queryFn: async (): Promise<PayrollInput[]> => (await get(`${P}/inputs`, { query: query({ companyId: companyId as string, period }) }, z.object({ items: z.array(payrollInput) }))).items })
export const usePutInput = () => useWrite(({ employeeId, period, body }: { employeeId: string; period: string; body: Record<string, unknown> }) => send('PUT', `${P}/employees/${employeeId}/inputs/${period}`, body, payrollInput))

export const useRuns = (companyId: string | undefined) => useList(['runs', companyId], Boolean(companyId), (cursor) => get(`${P}/runs`, { query: query({ companyId: companyId as string, limit: 100, cursor }) }, page(payrollRunHeader)))
export const useRun = (id: string | undefined): ReturnType<typeof useQuery<PayrollRun>> => useQuery({ queryKey: ['payroll', 'run', id], enabled: Boolean(id), queryFn: () => get(`${P}/runs/{id}`, { path: { id } }, payrollRun) })
export const useCreateRun = () => useWrite(({ body, key }: { body: { companyId: string; period: string; payDate: string }; key: string }) => send('POST', `${P}/runs`, body, payrollRun, key))
export const usePayRun = (id: string) => useWrite((b: { date: string; paidFromAccountId: string }) => send('POST', `${P}/runs/${id}/pay`, b, payrollRun, crypto.randomUUID()))
export const useCancelRun = (id: string) => useWrite((b: { date: string; reason: string }) => send('POST', `${P}/runs/${id}/cancel`, b, payrollRun, crypto.randomUUID()))
export const useLiabilities = (companyId: string | undefined) => useQuery({ queryKey: ['payroll', 'liabilities', companyId], enabled: Boolean(companyId), queryFn: (): Promise<PayrollLiabilities> => get(`${P}/liabilities`, { query: query({ companyId: companyId as string }) }, payrollLiabilities) })
export const useRemit = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${P}/remittances`, body, remittance, key))
export type { Employee }
export const usePutRates = () => useWrite((b: { companyId: string; effectiveFrom: string; rates: { code: string; value: string }[] }) => send('PUT', `${P}/rules/rates`, b, z.unknown()))
export const usePutSlabs = () => useWrite((b: { companyId: string; kind: string; stateCode?: string; effectiveFrom: string; slabs: { from: string; to: string | null; ratePercent?: string; fixedAmount?: string }[] }) => send('PUT', `${P}/rules/slabs`, b, z.unknown()))
