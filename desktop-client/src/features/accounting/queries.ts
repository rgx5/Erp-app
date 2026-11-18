import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  accountLedger, balanceSheet, bankAccount, bankCandidate, bankLine, bankReconciliation, bankStatement, cashFlow, fiscalYearWithPeriods, journalEntry, journalHeader, ledgerAccount, page, profitLoss, trialBalance, yearClosing,
  type AccountLedger, type BalanceSheet, type BankReconciliation, type CashFlow, type FiscalYearWithPeriods, type JournalEntry, type LedgerAccount, type ProfitLoss, type TrialBalance, type YearClosing,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
export type JournalInput = Body<'/v1/journal-entries', 'post'>

async function allPages<T>(load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  do { const p = await load(cursor); out.push(...p.items); cursor = p.nextCursor ?? undefined } while (cursor)
  return out
}

/** The whole chart of a company (a few hundred rows at most), cached. */
export const useAccounts = (companyId: string | undefined) =>
  useQuery({ queryKey: ['accounts', companyId], enabled: Boolean(companyId), staleTime: 60_000, queryFn: (): Promise<LedgerAccount[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounts', { params: { query: query({ companyId: companyId as string, limit: 200, cursor }) } }), page(ledgerAccount)) }) })

export const useJournals = (companyId: string | undefined, f: { from?: string; to?: string; journalType?: string }) => {
  const q = useInfiniteQuery({
    queryKey: ['journals', companyId, f], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/journal-entries', { params: { query: query({ limit: 100, cursor: pageParam, companyId: companyId as string, ...f }) } }), page(journalHeader)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] }
}
export const useJournal = (id: string | undefined) => useQuery({ queryKey: ['journal', id], enabled: Boolean(id), queryFn: (): Promise<JournalEntry> => { const api = currentApi(); return api.call(api.raw.GET('/v1/journal-entries/{id}', { params: { path: { id: id as string } } }), journalEntry) } })

export const useFiscalYears = (companyId: string | undefined) =>
  useQuery({ queryKey: ['fiscal-years-full', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<FiscalYearWithPeriods[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/fiscal-years', { params: { query: query({ companyId: companyId as string }) } }), z.object({ items: z.array(fiscalYearWithPeriods) }))).items } })
export const useYearClosings = (companyId: string | undefined) =>
  useQuery({ queryKey: ['year-closings', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<YearClosing[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/accounting/year-end-closings', { params: { query: query({ companyId: companyId as string }) } }), z.object({ items: z.array(yearClosing) }))).items } })

export const useTrialBalance = (companyId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['trial-balance', companyId, from, to], enabled: Boolean(companyId && from && to && to >= from), queryFn: (): Promise<TrialBalance> => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/trial-balance', { params: { query: query({ companyId: companyId as string, from, to }) } }), trialBalance) } })
export const useAccountLedger = (companyId: string | undefined, accountId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['account-ledger', companyId, accountId, from, to], enabled: Boolean(companyId && accountId), queryFn: (): Promise<AccountLedger> => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/account-ledger', { params: { query: query({ companyId: companyId as string, accountId: accountId as string, from, to, limit: 2000 }) } }), accountLedger) } })
export const useProfitLoss = (companyId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['profit-loss', companyId, from, to], enabled: Boolean(companyId && from && to && to >= from), queryFn: (): Promise<ProfitLoss> => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/statements/profit-loss', { params: { query: query({ companyId: companyId as string, from, to }) } }), profitLoss) } })
export const useBalanceSheet = (companyId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['balance-sheet', companyId, asOf], enabled: Boolean(companyId && asOf), queryFn: (): Promise<BalanceSheet> => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/statements/balance-sheet', { params: { query: query({ companyId: companyId as string, asOf }) } }), balanceSheet) } })
export const useCashFlow = (companyId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['cash-flow', companyId, from, to], enabled: Boolean(companyId && from && to && to >= from), queryFn: (): Promise<CashFlow> => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/statements/cash-flow', { params: { query: query({ companyId: companyId as string, from, to }) } }), cashFlow) } })

const KEYS = ['accounts', 'journals', 'journal', 'fiscal-years-full', 'year-closings', 'trial-balance', 'account-ledger', 'profit-loss', 'balance-sheet', 'cash-flow', 'dashboard', 'bank-accounts', 'bank-lines', 'bank-reconciliation', 'bank-statements', 'approvals']
function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
export const usePostJournal = () => useWrite(({ body, key, approvalId }: { body: JournalInput; key: string; approvalId?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/journal-entries', { body, headers: { 'idempotency-key': key, ...(approvalId ? { 'approval-id': approvalId } : {}) } }), journalEntry) })
export const useReverseJournal = (id: string) => useWrite((body: { postingDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/journal-entries/{id}/reverse', { params: { path: { id } }, body }), journalEntry) })
export const useCreateAccount = () => useWrite((body: Body<'/v1/accounts', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/accounts', { body }), ledgerAccount) })
export const useUpdateAccount = () => useWrite(({ id, version, body }: { id: string; version: number; body: Body<'/v1/accounts/{id}', 'patch'> }) => { const api = currentApi(); return api.call(api.raw.PATCH('/v1/accounts/{id}', { params: { path: { id } }, headers: { 'if-match': String(version) }, body }), ledgerAccount) })
export const useCreateFiscalYear = () => useWrite((body: Body<'/v1/fiscal-years', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/fiscal-years', { body }), z.unknown()) })
export const usePeriodAction = () => useWrite(({ id, action }: { id: string; action: 'close' | 'reopen' | 'lock' }) => { const api = currentApi(); const path = { params: { path: { id } } }; return api.call(action === 'close' ? api.raw.POST('/v1/accounting-periods/{id}/close', path) : action === 'reopen' ? api.raw.POST('/v1/accounting-periods/{id}/reopen', path) : api.raw.POST('/v1/accounting-periods/{id}/lock', path), accountingPeriodResult) })
const accountingPeriodResult = z.unknown()
export const useCloseYear = () => useWrite((id: string) => { const api = currentApi(); return api.call(api.raw.POST('/v1/accounting/fiscal-years/{id}/close-year', { params: { path: { id } }, headers: { 'idempotency-key': `close-year-${id}` } }), yearClosing.partial().passthrough()) })
export const useReopenYear = () => useWrite(({ id, reason }: { id: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/accounting/fiscal-years/{id}/reopen-year', { params: { path: { id } }, body: { reason }, headers: { 'idempotency-key': crypto.randomUUID() } }), yearClosing.partial().passthrough()) })

// ---- bank reconciliation ----
export const useBankAccounts = (companyId: string | undefined) =>
  useQuery({ queryKey: ['bank-accounts', companyId], enabled: Boolean(companyId), queryFn: async () => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/bank-accounts', { params: { query: query({ companyId: companyId as string }) } }), z.object({ items: z.array(bankAccount) }))).items } })
export const useBankStatements = (bankAccountId: string | undefined) =>
  useQuery({ queryKey: ['bank-statements', bankAccountId], enabled: Boolean(bankAccountId), queryFn: async () => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/bank-accounts/{id}/statements', { params: { path: { id: bankAccountId as string }, query: query({ limit: 200 }) } }), page(bankStatement))).items } })
export const useBankLines = (bankAccountId: string | undefined, status?: string) =>
  useQuery({ queryKey: ['bank-lines', bankAccountId, status], enabled: Boolean(bankAccountId), queryFn: async () => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/bank-accounts/{id}/statement-lines', { params: { path: { id: bankAccountId as string }, query: query({ limit: 200, status }) } }), page(bankLine))).items } })
export const useBankCandidates = (lineId: string | undefined, scope: 'exact' | 'any') =>
  useQuery({ queryKey: ['bank-lines', 'candidates', lineId, scope], enabled: Boolean(lineId), queryFn: async () => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/bank-statement-lines/{id}/candidates', { params: { path: { id: lineId as string }, query: query({ days: 10, scope }) } }), z.object({ items: z.array(bankCandidate) }))).items } })
export const useBankReconciliation = (bankAccountId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['bank-reconciliation', bankAccountId, asOf], enabled: Boolean(bankAccountId && asOf), queryFn: (): Promise<BankReconciliation> => { const api = currentApi(); return api.call(api.raw.GET('/v1/bank-accounts/{id}/reconciliation', { params: { path: { id: bankAccountId as string }, query: query({ asOf }) } }), bankReconciliation) } })

export const useCreateBankAccount = () => useWrite((body: Body<'/v1/bank-accounts', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-accounts', { body }), bankAccount) })
export const useImportStatement = (bankAccountId: string) => useWrite(({ body, key }: { body: Body<'/v1/bank-accounts/{id}/statements', 'post'>; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-accounts/{id}/statements', { params: { path: { id: bankAccountId } }, body, headers: { 'idempotency-key': key } }), bankStatement.passthrough()) })
export const useMatchLine = () => useWrite(({ lineId, journalLineIds }: { lineId: string; journalLineIds: string[] }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-statement-lines/{id}/match', { params: { path: { id: lineId } }, body: { journalLineIds }, headers: { 'idempotency-key': crypto.randomUUID() } }), bankLine.passthrough()) })
export const useUnmatchLine = () => useWrite(({ lineId, reason }: { lineId: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-statement-lines/{id}/unmatch', { params: { path: { id: lineId } }, body: { reason }, headers: { 'idempotency-key': crypto.randomUUID() } }), bankLine.passthrough()) })
export const useIgnoreLine = () => useWrite(({ lineId, reason }: { lineId: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-statement-lines/{id}/ignore', { params: { path: { id: lineId } }, body: { reason }, headers: { 'idempotency-key': crypto.randomUUID() } }), bankLine.passthrough()) })
export const useBookLine = () => useWrite(({ lineId, accountId, description }: { lineId: string; accountId: string; description?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-statement-lines/{id}/book', { params: { path: { id: lineId } }, body: { accountId, ...(description ? { description } : {}) }, headers: { 'idempotency-key': crypto.randomUUID() } }), z.unknown()) })
export const useAutoMatch = (bankAccountId: string) => useWrite(() => { const api = currentApi(); return api.call(api.raw.POST('/v1/bank-accounts/{id}/auto-match', { params: { path: { id: bankAccountId } }, body: { days: 3 }, headers: { 'idempotency-key': crypto.randomUUID() } }), z.object({ considered: z.number(), matched: z.number(), ambiguous: z.number(), unmatched: z.number() })) })
