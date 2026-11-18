import { it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('payroll answers match what the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'ppr' })
  const out: Record<string, unknown> = {}
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10); const ym = d.slice(0, 7)
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string; name: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  out['acctsPayroll'] = accts.filter((x) => /^(2|5)/.test(x.code)).map((x) => `${x.code} ${x.name}`)
  out['settings0'] = await s.call('GET', `/v1/payroll/companies/${c}/settings`)
  out['seed'] = await s.call('POST', `/v1/payroll/rules/seed-defaults?companyId=${c}&effectiveFrom=${s.year}-04-01`, {})
  out['rules'] = await s.call('GET', `/v1/payroll/rules?companyId=${c}&date=${d}&stateCode=27`)
  out['comp'] = await s.call('POST', '/v1/payroll/components', { companyId: c, code: 'HRA', name: 'House rent allowance', kind: 'earning', calculation: 'percent_of_basic', percent: '40' })
  out['comps'] = await s.call('GET', `/v1/payroll/components?companyId=${c}`)
  out['emp'] = await s.call('POST', '/v1/payroll/employees', { companyId: c, kind: 'employee', dateOfJoining: `${s.year}-04-01`, fullName: 'Ravi Kumar', stateCode: '27', pfApplicable: true, esiApplicable: false, ptApplicable: true })
  const eid = (out['emp'] as { id: string }).id
  out['struct'] = await s.call('POST', `/v1/payroll/employees/${eid}/structures`, { effectiveFrom: `${s.year}-04-01`, basic: '30000', lines: [{ componentId: (out['comp'] as { id: string }).id }] })
  out['structs'] = await s.call('GET', `/v1/payroll/employees/${eid}/structures`)
  out['input'] = await s.call('PUT', `/v1/payroll/employees/${eid}/inputs/${ym}`, { lopDays: '2', bonus: '1000', otherDeduction: '0' })
  out['inputs'] = await s.call('GET', `/v1/payroll/inputs?companyId=${c}&period=${ym}`)
  out['emps'] = await s.call('GET', `/v1/payroll/employees?companyId=${c}`)
  const parent = a('2100')
  const mk = async (code: string, name: string) => ((await s.call('POST', '/v1/accounts', { companyId: c, code, name, type: 'liability', parentId: parent })) as { id: string }).id
  const sp = await mk('2150', 'Salary payable'); const pf = await mk('2160', 'PF payable'); const esi = await mk('2170', 'ESI payable'); const pt = await mk('2180', 'PT payable'); const od = await mk('2190', 'Other deductions payable')
  out['settings'] = await s.call('PUT', `/v1/payroll/companies/${c}/settings`, { salaryExpenseAccountId: a('5500'), employerCostAccountId: a('5500'), salaryPayableAccountId: sp, pfPayableAccountId: pf, esiPayableAccountId: esi, ptPayableAccountId: pt, tdsPayableAccountId: a('2240'), otherDeductionsAccountId: od })
  out['run'] = await s.call('POST', '/v1/payroll/runs', { companyId: c, period: ym, payDate: d })
  const rid = (out['run'] as { id: string }).id
  out['runs'] = await s.call('GET', `/v1/payroll/runs?companyId=${c}`)
  out['liab0'] = await s.call('GET', `/v1/payroll/liabilities?companyId=${c}`)
  out['paid'] = await s.call('POST', `/v1/payroll/runs/${rid}/pay`, { date: d, paidFromAccountId: s.bank })
  out['remit'] = await s.call('POST', '/v1/payroll/remittances', { companyId: c, kind: 'pf', period: ym, date: d, amount: '100', paidFromAccountId: s.bank })
  out['liab1'] = await s.call('GET', `/v1/payroll/liabilities?companyId=${c}`)
  out['payslips'] = await s.call('GET', `/v1/payroll/employees/${eid}/payslips`)
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 600)}`) }
  ok(S.payrollSettings, out['settings'], 'settings'); ok(S.payrollRules, out['rules'], 'rules'); ok(S.payrollSeed, out['seed'], 'seed'); ok(S.payComponent, out['comp'], 'component')
  ok(S.employee, out['emp'], 'employee'); ok(S.page(S.employee), out['emps'], 'employees'); ok(S.salaryStructure, out['struct'], 'structure'); ok(S.payrollInput, out['input'], 'input')
  ok(S.payrollRun, out['run'], 'run'); ok(S.payrollRun, out['paid'], 'paid run'); ok(S.page(S.payrollRunHeader), out['runs'], 'runs'); ok(S.payrollLiabilities, out['liab1'], 'liabilities'); ok(S.remittance, out['remit'], 'remittance')
  for (const p of (out['payslips'] as { items: unknown[] }).items) ok(S.payslip, p, 'payslip')
})
