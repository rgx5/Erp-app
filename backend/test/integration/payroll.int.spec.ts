import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Co extends Shop { comp: { hra: string; special: string; loan: string }; people: { asha: string; bharat: string; worker: string; esi: string; joiner: string } }
const P = (s: Shop, path: string) => `/v1/payroll/${path}`;

/** A company with payroll accounts, statutory defaults for 2025-26, components, and five people of different kinds. */
async function company(name: string, o: { settings?: boolean; rules?: boolean; people?: boolean } = {}): Promise<Co> {
  const s = await kit.shop(name);
  const acct = async (code: string, accountName: string) => { s.acc[code] = ok(await call(server, 'POST', '/v1/accounts', { tenant: s.tenant, body: { companyId: s.companyId, code, name: accountName, type: 'liability', parentId: s.acc['2100'] } })).id as string; };
  for (const [code, n] of [['2150', 'Salary payable'], ['2160', 'PF payable'], ['2170', 'ESI payable'], ['2180', 'Professional tax payable'], ['2190', 'Other deductions payable']] as const) await acct(code, n);
  if (o.settings !== false) {
    ok(await call(server, 'PUT', P(s, `companies/${s.companyId}/settings`), { tenant: s.tenant, body: { salaryExpenseAccountId: s.acc['5500'], employerCostAccountId: s.acc['5500'], salaryPayableAccountId: s.acc['2150'], pfPayableAccountId: s.acc['2160'], esiPayableAccountId: s.acc['2170'], ptPayableAccountId: s.acc['2180'], tdsPayableAccountId: s.acc['2240'], otherDeductionsAccountId: s.acc['2190'] } }), 200);
  }
  if (o.rules !== false) ok(await call(server, 'POST', P(s, `rules/seed-defaults?companyId=${s.companyId}&effectiveFrom=2025-04-01`), { tenant: s.tenant, body: {} }), 200);
  const component = async (code: string, body: object) => ok(await call(server, 'POST', P(s, 'components'), { tenant: s.tenant, body: { companyId: s.companyId, code, name: code, ...body } })).id as string;
  const comp = {
    hra: await component('HRA', { kind: 'earning', calculation: 'percent_of_basic', percent: '40', esiWage: true }),
    special: await component('SPECIAL', { kind: 'earning', calculation: 'fixed', esiWage: true }),
    loan: await component('LOAN', { kind: 'deduction', calculation: 'fixed', isTaxable: false }),
  };
  const person = (body: object) => call(server, 'POST', P(s, 'employees'), { tenant: s.tenant, body: { companyId: s.companyId, stateCode: '27', dateOfJoining: '2025-01-01', ...body } });
  const structure = async (id: string, body: object) => ok(await call(server, 'POST', P(s, `employees/${id}/structures`), { tenant: s.tenant, body }));
  const people = { asha: '', bharat: '', worker: '', esi: '', joiner: '' };
  if (o.people !== false) {
    people.asha = ok(await person({ fullName: 'Asha', pan: 'ABCDE1234F', pfApplicable: true, ptApplicable: true })).id;
    await structure(people.asha, { effectiveFrom: '2025-01-01', basic: '30000', lines: [{ componentId: comp.hra }, { componentId: comp.special, amount: '10000' }, { componentId: comp.loan, amount: '2000' }] });
    people.bharat = ok(await person({ fullName: 'Bharat', pfApplicable: true, ptApplicable: true })).id;
    await structure(people.bharat, { effectiveFrom: '2025-01-01', basic: '100000', lines: [{ componentId: comp.special, amount: '50000' }] });
    people.worker = ok(await person({ kind: 'contract_worker', fullName: 'Chandu', payBasis: 'daily', tdsRatePercent: '1' })).id;
    await structure(people.worker, { effectiveFrom: '2025-01-01', basic: '800' });
    people.esi = ok(await person({ fullName: 'Deepa', pfApplicable: true, esiApplicable: true, ptApplicable: true })).id;
    await structure(people.esi, { effectiveFrom: '2025-01-01', basic: '12000' });
    people.joiner = ok(await person({ fullName: 'Esha', dateOfJoining: '2025-04-16' })).id;
    await structure(people.joiner, { effectiveFrom: '2025-04-16', basic: '30000' });
    ok(await call(server, 'PUT', P(s, `employees/${people.worker}/inputs/2025-04`), { tenant: s.tenant, body: { unitsWorked: '22.5' } }), 200);
  }
  return { ...s, comp, people };
}
const run = (c: Co, period = '2025-04', payDate = '2025-04-30') => call(server, 'POST', P(c, 'runs'), { tenant: c.tenant, body: { companyId: c.companyId, period, payDate } });
const net = async (c: Co, code: string) => {
  const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${c.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: c.tenant })).json;
  expect(t.balanced).toBe(true);
  const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined;
  return r ? Math.round((Number(r.closingDebit) - Number(r.closingCredit)) * 10000) / 10000 : 0;
};
const slip = (r: { payslips: { employeeId: string }[] }, id: string) => r.payslips.find((p) => p.employeeId === id) as unknown as Record<string, string> & { detail: Record<string, unknown> };

describe('statutory rules', () => {
  it('seeds starting values, resolves the set in force on a date, and never edits a rule', async () => {
    const c = await company('Pr Rules Co', { people: false });
    const rules = (date: string) => call(server, 'GET', P(c, `rules?companyId=${c.companyId}&date=${date}&stateCode=27`), { tenant: c.tenant });
    const r = (await rules('2025-06-01')).json;
    expect(r.pf).toEqual({ employeePercent: '12.0000', employerPercent: '12.0000', ceiling: '15000.0000' });
    expect(r.esi).toEqual({ employeePercent: '0.7500', employerPercent: '3.2500', ceiling: '21000.0000' });
    expect(r.regimes[0]).toMatchObject({ regime: 'new', tdsSlabs: 7, ptSlabs: 3, standardDeduction: '75000.0000', rebateLimit: '1200000.0000', cessPercent: '4.0000', missing: [] });
    expect((await rules('2025-03-31')).json.regimes[0].missing).toContain('pf_employee_percent'); // nothing before the first rules
    // a later change is a new dated rule; earlier dates keep the old one
    ok(await call(server, 'PUT', P(c, 'rules/rates'), { tenant: c.tenant, body: { companyId: c.companyId, effectiveFrom: '2025-09-01', rates: [{ code: 'pf_wage_ceiling', value: '21000' }] } }), 200);
    expect((await rules('2025-08-31')).json.pf.ceiling).toBe('15000.0000');
    expect((await rules('2025-09-01')).json.pf.ceiling).toBe('21000.0000');
    const again = await call(server, 'PUT', P(c, 'rules/rates'), { tenant: c.tenant, body: { companyId: c.companyId, effectiveFrom: '2025-09-01', rates: [{ code: 'pf_wage_ceiling', value: '25000' }] } });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('rate_exists');
    // slab sets: validated, and a later set replaces the earlier one from its date
    const slabs = (body: object) => call(server, 'PUT', P(c, 'rules/slabs'), { tenant: c.tenant, body: { companyId: c.companyId, effectiveFrom: '2026-04-01', ...body } });
    expect((await slabs({ kind: 'pt', slabs: [{ from: '0', to: null, fixedAmount: '100' }] })).status).toBe(422); // a state is needed
    expect((await slabs({ kind: 'tds_new', stateCode: '27', slabs: [{ from: '0', to: null, ratePercent: '5' }] })).status).toBe(422);
    expect((await slabs({ kind: 'tds_new', slabs: [{ from: '0', to: '500000', ratePercent: '0' }, { from: '400000', to: null, ratePercent: '10' }] })).status).toBe(422); // overlap
    expect((await slabs({ kind: 'tds_new', slabs: [{ from: '0', to: '500000', ratePercent: '0' }] })).status).toBe(422); // must be open-ended
    expect((await slabs({ kind: 'tds_new', slabs: [{ from: '0', to: '500000', fixedAmount: '1' }, { from: '500000', to: null, ratePercent: '5' }] })).status).toBe(422);
    ok(await slabs({ kind: 'tds_new', slabs: [{ from: '0', to: '500000', ratePercent: '0' }, { from: '500000', to: null, ratePercent: '10' }] }), 200);
    expect((await slabs({ kind: 'tds_new', slabs: [{ from: '0', to: null, ratePercent: '1' }] })).json.code).toBe('slabs_exist');
    expect((await rules('2026-03-31')).json.regimes[0].tdsSlabs).toBe(7);
    expect((await rules('2026-04-01')).json.regimes[0].tdsSlabs).toBe(2);
  });
});

describe('people and pay structures', () => {
  it('validates people, components and structures, and numbers employees and contract workers apart', async () => {
    const c = await company('Pr People Co', { people: false });
    const person = (body: object) => call(server, 'POST', P(c, 'employees'), { tenant: c.tenant, body: { companyId: c.companyId, fullName: 'X', stateCode: '27', dateOfJoining: '2025-01-01', ...body } });
    const a = ok(await person({ pan: 'ABCDE1234F' }));
    expect(a).toMatchObject({ employeeNo: 'EMP-000001', kind: 'employee', status: 'active', payBasis: 'monthly', taxRegime: 'new', pfApplicable: false });
    expect(ok(await person({ kind: 'contract_worker', payBasis: 'daily', tdsRatePercent: '2' })).employeeNo).toBe('CWK-000001');
    expect((await person({ pan: 'abcde1234f' })).status).toBe(409); // PAN is unique among people still employed (case-insensitive input)
    expect((await person({ pan: 'BAD' })).status).toBe(422);
    expect((await person({ kind: 'contract_worker' })).status).toBe(422); // a monthly contract worker needs a TDS rate
    expect((await person({ stateCode: 'MH' })).status).toBe(422);
    // updating, and leaving
    expect(ok(await call(server, 'PATCH', P(c, `employees/${a.id}`), { tenant: c.tenant, body: { pfApplicable: true, taxRegime: 'old' } }), 200)).toMatchObject({ pfApplicable: true, taxRegime: 'old', version: 2 });
    expect((await call(server, 'PATCH', P(c, `employees/${a.id}`), { tenant: c.tenant, body: {} })).status).toBe(422);
    expect((await call(server, 'POST', P(c, `employees/${a.id}/exit`), { tenant: c.tenant, body: { dateOfLeaving: '2024-12-31' } })).status).toBe(422);
    ok(await call(server, 'POST', P(c, `employees/${a.id}/exit`), { tenant: c.tenant, body: { dateOfLeaving: '2025-05-15' } }), 200);
    expect((await call(server, 'POST', P(c, `employees/${a.id}/exit`), { tenant: c.tenant, body: { dateOfLeaving: '2025-05-16' } })).json.code).toBe('employee_exited');
    expect((await call(server, 'PATCH', P(c, `employees/${a.id}`), { tenant: c.tenant, body: { uan: '1' } })).json.code).toBe('employee_exited');
    // components
    const comp = (body: object) => call(server, 'POST', P(c, 'components'), { tenant: c.tenant, body: { companyId: c.companyId, name: 'N', kind: 'earning', ...body } });
    expect((await comp({ code: 'BONUSX', calculation: 'percent_of_basic' })).status).toBe(422); // a percent is needed
    expect((await comp({ code: 'BONUSY', calculation: 'fixed', percent: '5' })).status).toBe(422);
    expect((await comp({ code: 'DEDX', kind: 'deduction', calculation: 'fixed', pfWage: true })).status).toBe(422); // a deduction is not PF wages
    expect((await comp({ code: 'bad code', calculation: 'fixed' })).status).toBe(422);
    expect((await comp({ code: 'HRA', calculation: 'fixed' })).status).toBe(409); // HRA exists
    expect((await call(server, 'PATCH', P(c, `components/${c.comp.hra}`), { tenant: c.tenant, body: { name: 'House rent allowance' } })).status).toBe(200);
    // structures
    const b = ok(await person({ fullName: 'B' }));
    const st = (body: object) => call(server, 'POST', P(c, `employees/${b.id}/structures`), { tenant: c.tenant, body });
    expect((await st({ effectiveFrom: '2024-12-31', basic: '1000' })).status).toBe(422); // before joining
    expect((await st({ effectiveFrom: '2025-01-01', basic: '0' })).status).toBe(422);
    expect((await st({ effectiveFrom: '2025-01-01', basic: '1000', lines: [{ componentId: c.comp.special }] })).status).toBe(422); // a fixed component needs an amount
    expect((await st({ effectiveFrom: '2025-01-01', basic: '1000', lines: [{ componentId: c.comp.hra, amount: '5' }] })).status).toBe(422); // a percent one must not
    expect((await st({ effectiveFrom: '2025-01-01', basic: '1000', lines: [{ componentId: c.comp.hra }, { componentId: c.comp.hra }] })).status).toBe(422);
    ok(await st({ effectiveFrom: '2025-01-01', basic: '1000', lines: [{ componentId: c.comp.hra }] }));
    expect((await st({ effectiveFrom: '2025-01-01', basic: '2000' })).status).toBe(409); // never replaced: a revision needs a later date
    ok(await st({ effectiveFrom: '2025-07-01', basic: '2000' }));
    const list = (await call(server, 'GET', P(c, `employees/${b.id}/structures`), { tenant: c.tenant })).json.items;
    expect(list.map((x: { basic: string }) => x.basic)).toEqual(['2000.0000', '1000.0000']);
  });
});

describe('monthly payroll', () => {
  it('pays everyone from their structure and the rules in force, and books the whole thing', async () => {
    const c = await company('Pr Run Co');
    const r = ok(await run(c), 201);
    expect(r).toMatchObject({ runNo: 'PR/2526/000001', period: '2025-04', status: 'posted', grossTotal: '247000.0000', netTotal: '226523.0000', employeeDeductions: '20477.0000', pfTotal: '10080.0000', esiTotal: '480.0000', ptTotal: '600.0000', tdsTotal: '12747.0000', employerCostTotal: '252430.0000' });
    expect(r.payslips).toHaveLength(5);
    const asha = slip(r, c.people.asha);
    expect(asha).toMatchObject({ gross: '52000.0000', pfEmployee: '1800.0000', pfEmployer: '1800.0000', professionalTax: '200.0000', tds: '0.0000', otherDeductions: '2000.0000', net: '48000.0000', employeeNo: 'EMP-000001' });
    expect(asha.detail).toMatchObject({ pfWages: '15000.0000', taxableGross: '52000.0000', earnings: [{ code: 'BASIC', amount: '30000.0000' }, { code: 'HRA', amount: '12000.0000' }, { code: 'SPECIAL', amount: '10000.0000' }], deductions: [{ code: 'LOAN', amount: '2000.0000' }] });
    expect(slip(r, c.people.bharat)).toMatchObject({ gross: '150000.0000', tds: '12567.0000', net: '135433.0000' });
    expect(slip(r, c.people.bharat).detail.tdsBasis).toMatchObject({ projectedAnnual: '1800000.0000', taxableIncome: '1725000.0000', annualTax: '150800.0000' });
    expect(slip(r, c.people.worker)).toMatchObject({ gross: '18000.0000', tds: '180.0000', pfEmployee: '0.0000', net: '17820.0000' }); // 22.5 days at 800, 1% TDS
    expect(slip(r, c.people.esi)).toMatchObject({ gross: '12000.0000', pfEmployee: '1440.0000', esiEmployee: '90.0000', esiEmployer: '390.0000', professionalTax: '200.0000', net: '10270.0000' });
    expect(slip(r, c.people.joiner)).toMatchObject({ gross: '15000.0000', net: '15000.0000' }); // joined on the 16th: 15 of 30 days
    // the books
    expect(await net(c, '5500')).toBe(252430); // salaries plus the employer's PF and ESI
    expect(await net(c, '2150')).toBe(-226523);
    expect(await net(c, '2160')).toBe(-10080);
    expect(await net(c, '2170')).toBe(-480);
    expect(await net(c, '2180')).toBe(-600);
    expect(await net(c, '2240')).toBe(-12747);
    expect(await net(c, '2190')).toBe(-2000);
    // a second run for the month is refused; the payslips are listed per person
    expect((await run(c)).json.code).toBe('run_exists');
    const mine = (await call(server, 'GET', P(c, `employees/${c.people.bharat}/payslips`), { tenant: c.tenant })).json.items;
    expect(mine).toHaveLength(1);
    expect((await call(server, 'GET', P(c, `runs?companyId=${c.companyId}`), { tenant: c.tenant })).json.items).toHaveLength(1);
  });

  it('carries year-to-date tax into the next month, prorates unpaid leave, and applies one-offs', async () => {
    const c = await company('Pr May Co');
    ok(await run(c), 201);
    // May: the worker's days are missing, so the run says who cannot be paid and why
    const blocked = await run(c, '2025-05', '2025-05-31');
    expect(blocked.status).toBe(422);
    expect(blocked.json).toMatchObject({ code: 'payroll_not_ready', problems: [{ employeeNo: 'CWK-000001', problem: 'no days worked entered' }] });
    const put = (id: string, body: object) => call(server, 'PUT', P(c, `employees/${id}/inputs/2025-05`), { tenant: c.tenant, body });
    expect((await put(c.people.asha, { unitsWorked: '3' })).status).toBe(422); // monthly people have no units
    expect((await put(c.people.worker, { lopDays: '0' })).status).toBe(422); // a worker needs the days
    ok(await put(c.people.worker, { unitsWorked: '20' }), 200);
    ok(await put(c.people.asha, { lopDays: '3', bonus: '5000', otherDeduction: '500', notes: 'Diwali bonus' }), 200);
    const r = ok(await run(c, '2025-05', '2025-05-31'), 201);
    // 3 of 31 days unpaid: basic 30,000 x 28/31, HRA 40% of that, special pro rata, plus bonus
    expect(slip(r, c.people.asha).detail).toMatchObject({ paidDays: '2800/3100', earnings: [{ amount: '27096.7742' }, { amount: '10838.7097' }, { amount: '9032.2581' }], bonus: '5000.0000', otherDeduction: '500.0000' });
    expect(slip(r, c.people.asha).gross).toBe('51967.7420');
    expect(slip(r, c.people.worker)).toMatchObject({ gross: '16000.0000', tds: '160.0000' });
    // Bharat: 150,800 a year, 12,567 deducted in April, the rest over the 11 months left
    expect(slip(r, c.people.bharat)).toMatchObject({ tds: '12567.0000' });
    expect(slip(r, c.people.bharat).detail.tdsBasis).toMatchObject({ projectedAnnual: '1800000.0000', annualTax: '150800.0000' });
    // the inputs of a processed month are frozen, until the run is cancelled
    expect((await put(c.people.asha, { lopDays: '1' })).json.code).toBe('period_processed');
    ok(await call(server, 'POST', P(c, `runs/${r.id}/cancel`), { tenant: c.tenant, body: { date: '2025-05-31', reason: 'Wrong leave' } }), 200);
    ok(await put(c.people.asha, { lopDays: '1' }), 200);
    expect((await call(server, 'GET', P(c, `inputs?companyId=${c.companyId}&period=2025-05`), { tenant: c.tenant })).json.items).toHaveLength(2);
  });

  it('stops paying people who have left, from the month they leave', async () => {
    const c = await company('Pr Exit Co');
    ok(await call(server, 'POST', P(c, `employees/${c.people.joiner}/exit`), { tenant: c.tenant, body: { dateOfLeaving: '2025-05-15' } }), 200);
    ok(await run(c), 201);
    ok(await call(server, 'PUT', P(c, `employees/${c.people.worker}/inputs/2025-05`), { tenant: c.tenant, body: { unitsWorked: '10' } }), 200);
    const may = ok(await run(c, '2025-05', '2025-05-31'), 201);
    expect(slip(may, c.people.joiner)).toMatchObject({ gross: '14516.1290' }); // 15 of 31 days
    ok(await call(server, 'PUT', P(c, `employees/${c.people.worker}/inputs/2025-06`), { tenant: c.tenant, body: { unitsWorked: '10' } }), 200);
    const june = ok(await run(c, '2025-06', '2025-06-30'), 201);
    expect(june.payslips).toHaveLength(4);
    expect(june.payslips.some((p: { employeeId: string }) => p.employeeId === c.people.joiner)).toBe(false);
  });
});

describe('paying and remitting', () => {
  it('pays the net salaries in one go, and remits what was deducted, never more than is owed', async () => {
    const c = await company('Pr Pay Co');
    const r = ok(await run(c), 201);
    const bank = c.acc['1120'];
    const pay = (id: string, body: object) => call(server, 'POST', P(c, `runs/${id}/pay`), { tenant: c.tenant, body });
    expect((await pay(r.id, { date: '2025-04-20', paidFromAccountId: bank })).status).toBe(422); // before the pay date
    expect((await pay(r.id, { date: '2025-05-02', paidFromAccountId: c.acc['2150'] })).status).toBe(422); // not a bank
    const paid = ok(await pay(r.id, { date: '2025-05-02', paidFromAccountId: bank }), 200);
    expect(paid).toMatchObject({ status: 'paid', paidOn: '2025-05-02' });
    expect(await net(c, '2150')).toBe(0);
    expect(await net(c, '1120')).toBe(-226523);
    expect((await pay(r.id, { date: '2025-05-03', paidFromAccountId: bank })).json.code).toBe('not_payable');
    expect((await call(server, 'POST', P(c, `runs/${r.id}/cancel`), { tenant: c.tenant, body: { date: '2025-05-03', reason: 'x' } })).json.code).toBe('not_cancellable'); // paid runs stay
    const owed = (await call(server, 'GET', P(c, `liabilities?companyId=${c.companyId}`), { tenant: c.tenant })).json;
    expect(owed.periods).toEqual([{ period: '2025-04', pf: '10080.0000', esi: '480.0000', pt: '600.0000', tds: '12747.0000' }]);
    const remit = (body: object) => call(server, 'POST', P(c, 'remittances'), { tenant: c.tenant, body: { companyId: c.companyId, period: '2025-04', date: '2025-05-15', paidFromAccountId: bank, ...body } });
    expect((await remit({ kind: 'pf', amount: '10081' })).json.code).toBe('exceeds_outstanding');
    const first = ok(await remit({ kind: 'pf', amount: '6000', reference: 'ECR-1' }));
    expect(first).toMatchObject({ remittanceNo: 'REM/2526/000001', kind: 'pf', amount: '6000.0000' });
    ok(await remit({ kind: 'pf', amount: '4080' }));
    expect((await remit({ kind: 'pf', amount: '1' })).json.code).toBe('exceeds_outstanding');
    ok(await remit({ kind: 'tds', amount: '12747' }));
    expect(await net(c, '2160')).toBe(0);
    expect(await net(c, '2240')).toBe(0);
    expect((await call(server, 'GET', P(c, `liabilities?companyId=${c.companyId}`), { tenant: c.tenant })).json.periods[0]).toMatchObject({ pf: '0.0000', tds: '0.0000', esi: '480.0000', pt: '600.0000' });
    expect((await remit({ kind: 'esi', period: '2025-07', amount: '1' })).json.code).toBe('exceeds_outstanding'); // no run that month
  });

  it('cancels an unpaid run completely, and lets the month be run again', async () => {
    const c = await company('Pr Cancel Co');
    const r = ok(await run(c), 201);
    const cancelled = ok(await call(server, 'POST', P(c, `runs/${r.id}/cancel`), { tenant: c.tenant, body: { date: '2025-04-30', reason: 'Wrong salaries' } }), 200);
    expect(cancelled.status).toBe('cancelled');
    for (const code of ['5500', '2150', '2160', '2170', '2180', '2240', '2190']) expect(await net(c, code)).toBe(0);
    expect((await call(server, 'GET', P(c, `employees/${c.people.bharat}/payslips`), { tenant: c.tenant })).json.items).toHaveLength(0);
    expect((await call(server, 'POST', P(c, `runs/${r.id}/cancel`), { tenant: c.tenant, body: { date: '2025-04-30', reason: 'again' } })).json.code).toBe('not_cancellable');
    expect(ok(await run(c), 201).runNo).toBe('PR/2526/000002');
    // a run with money already remitted cannot be cancelled
    const live = (await call(server, 'GET', P(c, `runs?companyId=${c.companyId}&status=posted`), { tenant: c.tenant })).json.items[0] as { id: string };
    ok(await call(server, 'POST', P(c, 'remittances'), { tenant: c.tenant, body: { companyId: c.companyId, kind: 'pt', period: '2025-04', date: '2025-05-10', amount: '100', paidFromAccountId: c.acc['1120'] } }));
    expect((await call(server, 'POST', P(c, `runs/${live.id}/cancel`), { tenant: c.tenant, body: { date: '2025-05-11', reason: 'x' } })).json.code).toBe('has_remittances');
  });
});

describe('refusals', () => {
  it('says what is missing: accounts, rules, structures, people', async () => {
    const bare = await company('Pr Bare Co', { settings: false });
    const r = await run(bare);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'payroll_accounts_not_configured', missing: ['salaryExpenseAccountId', 'salaryPayableAccountId', 'employerCostAccountId', 'pfPayableAccountId', 'esiPayableAccountId', 'ptPayableAccountId', 'tdsPayableAccountId', 'otherDeductionsAccountId'] });
    const put = (b: object) => call(server, 'PUT', P(bare, `companies/${bare.companyId}/settings`), { tenant: bare.tenant, body: b });
    expect((await put({ salaryPayableAccountId: bare.acc['5500'] })).status).toBe(422); // an expense
    expect((await put({ salaryExpenseAccountId: bare.acc['2150'] })).status).toBe(422); // a liability
    expect((await put({ pfPayableAccountId: bare.acc['2110'] })).status).toBe(422); // the payables control account
    expect((await put({})).status).toBe(422);
    const noRules = await company('Pr NoRules Co', { rules: false });
    const n = await run(noRules);
    expect(n.status).toBe(422);
    expect(n.json.code).toBe('payroll_not_ready');
    expect(n.json.problems[0].problem).toMatch(/statutory rules missing/);
    const noStructure = await company('Pr NoStruct Co', { people: false });
    ok(await call(server, 'POST', P(noStructure, 'employees'), { tenant: noStructure.tenant, body: { companyId: noStructure.companyId, fullName: 'Nobody Yet', stateCode: '27', dateOfJoining: '2025-01-01' } }));
    expect((await run(noStructure)).json.problems).toEqual([{ employeeNo: 'EMP-000001', problem: 'no salary structure in force' }]);
    const empty = await company('Pr Empty Co', { people: false });
    expect((await run(empty)).json.code).toBe('no_payroll');
    // nothing was booked by any of the refusals
    expect(await net(noStructure, '5500')).toBe(0);
    // a locked period refuses the run, rolling everything back
    const c = await company('Pr Locked Co');
    for (const p of c.periods.slice(0, 2)) ok(await call(server, 'POST', `/v1/accounting-periods/${p.id}/close`, { tenant: c.tenant }), 200);
    expect((await run(c)).json.code).toBe('period_closed');
    expect((await call(server, 'GET', P(c, `runs?companyId=${c.companyId}`), { tenant: c.tenant })).json.items).toHaveLength(0);
  });
});

describe('guards and access', () => {
  it('keeps payslips, runs, rules and structures immutable in the database', async () => {
    const c = await company('Pr Guard Co');
    const r = ok(await run(c), 201);
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.payslips SET net = 1 WHERE run_id = $1', [r.id]);
    await bad('DELETE FROM erp.payslips WHERE run_id = $1', [r.id]);
    await bad('UPDATE erp.payroll_runs SET net_total = 1 WHERE id = $1', [r.id]);
    await bad('DELETE FROM erp.payroll_runs WHERE id = $1', [r.id]);
    await bad("UPDATE erp.payroll_runs SET status = 'posted' WHERE id = $1", [r.id]);
    await bad('UPDATE erp.payroll_rates SET value = 1 WHERE company_id = $1', [c.companyId]);
    await bad('UPDATE erp.payroll_slabs SET rate_percent = 1 WHERE company_id = $1', [c.companyId]);
    await bad('UPDATE erp.salary_structures SET basic = 1 WHERE employee_id = $1', [c.people.asha]);
    await bad("UPDATE erp.salary_components SET percent = 1 WHERE id = $1", [c.comp.hra]);
    await bad("UPDATE erp.employees SET kind = 'contract_worker' WHERE id = $1", [c.people.asha]);
    await expect(supers.query("INSERT INTO erp.payroll_runs (tenant_id, id, company_id, run_no, period, pay_date, gross_total, employee_deductions, net_total, employer_cost_total) VALUES ($1, gen_random_uuid(), $2, 'RAW/1', '2025-04', '2025-04-30', 1, 0, 1, 1)", [c.tenant, c.companyId])).rejects.toMatchObject({ code: '23505' }); // one live run per month
    await expect(supers.query("INSERT INTO erp.payslips (tenant_id, id, run_id, employee_id, employee_no, employee_name, kind, period, gross, net, detail) SELECT tenant_id, gen_random_uuid(), run_id, employee_id, 'X', 'X', kind, period, 100, 99, '{}' FROM erp.payslips WHERE run_id = $1 LIMIT 1", [r.id])).rejects.toMatchObject({ code: '23514' }); // net must follow from the deductions
  });

  it('separates reading, managing, processing and cancelling, and keeps tenants apart', async () => {
    const c = await company('Pr Access Co');
    const r = ok(await run(c), 201);
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: c.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['payroll:read']);
    expect((await call(server, 'GET', P(c, `runs/${r.id}`), { token: reader })).status).toBe(200);
    expect((await call(server, 'GET', P(c, `employees?companyId=${c.companyId}`), { token: reader })).json.items).toHaveLength(5);
    expect((await call(server, 'POST', P(c, 'runs'), { token: reader, body: {} })).status).toBe(403);
    expect((await call(server, 'POST', P(c, 'employees'), { token: reader, body: {} })).status).toBe(403);
    const processor = await key(['payroll:process']);
    expect((await call(server, 'POST', P(c, `runs/${r.id}/cancel`), { token: processor, body: { date: '2025-04-30', reason: 'x' } })).status).toBe(403);
    expect((await call(server, 'PUT', P(c, 'rules/rates'), { token: processor, body: {} })).status).toBe(403);
    expect((await call(server, 'GET', P(c, `runs/${r.id}`), { token: processor })).status).toBe(403);
    const other = await company('Pr Access Other');
    expect((await call(server, 'GET', P(c, `runs/${r.id}`), { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', P(c, `employees/${c.people.asha}`), { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'POST', P(c, `runs/${r.id}/pay`), { tenant: other.tenant, body: { date: '2025-05-02', paidFromAccountId: other.acc['1120'] } })).status).toBe(404);
  });
});
