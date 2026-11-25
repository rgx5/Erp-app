import { describe, expect, it } from 'vitest';
import { fromGoogle, fromMeta, fromWebsite, normalizeEmail, normalizePhone, pickOwner } from './leads.logic.js';

describe('phone and email', () => {
  it('make the same person the same number', () => {
    for (const p of ['9810000001', '+91 98100 00001', '09810000001', '91-9810000001', '+91(981)0000001']) expect(normalizePhone(p), p).toBe('9810000001');
    expect(normalizePhone('12345')).toBeNull(); expect(normalizePhone(null)).toBeNull(); expect(normalizePhone('+1 415 555 0100')).toBe('14155550100');
  });
  it('tidy an email and refuse nonsense', () => { expect(normalizeEmail(' A@B.in ')).toBe('a@b.in'); expect(normalizeEmail('nope')).toBeNull(); });
});

describe('what arrives from each channel', () => {
  it('a website form: fields, campaign tags, click id, honest extras', () => {
    const l = fromWebsite({ full_name: 'Asha Rao', mobile: '98100 00001', email: 'A@x.in', city: 'Pune', zip: '411001', utm_source: 'facebook', utm_campaign: 'summer-solar', gclid: 'abc', message: 'Need 5kW', 'Monthly bill': '4500', consent: 'yes', page_url: 'https://x.in/solar' });
    expect(l).toMatchObject({ name: 'Asha Rao', phone: '98100 00001', email: 'A@x.in', city: 'Pune', pincode: '411001', campaign: 'summer-solar', clickId: 'abc', consent: true });
    expect(l.utm).toEqual({ utm_source: 'facebook', utm_campaign: 'summer-solar' });
    expect(l.fields).toMatchObject({ message: 'Need 5kW', monthly_bill: '4500', page_url: 'https://x.in/solar' });
  });
  it('first and last name are joined', () => { expect(fromWebsite({ first_name: 'Ravi', last_name: 'Kumar', phone: '9810000002' }).name).toBe('Ravi Kumar'); });
  it('a Meta lead: field_data, campaign, ad, and custom questions kept', () => {
    const l = fromMeta({ id: '555', campaign_name: 'Solar Q4', adset_name: 'Pune 25-55', ad_name: 'Rooftop video', form_name: 'Solar enquiry', field_data: [{ name: 'full_name', values: ['Meena Joshi'] }, { name: 'phone_number', values: ['+919810000003'] }, { name: 'city', values: ['Nashik'] }, { name: 'what_is_your_monthly_electricity_bill?', values: ['₹3000 - 5000'] }] });
    expect(l).toMatchObject({ name: 'Meena Joshi', phone: '+919810000003', city: 'Nashik', externalId: '555', campaign: 'Solar Q4', adset: 'Pune 25-55', ad: 'Rooftop video', formName: 'Solar enquiry' });
    expect(l.fields['what_is_your_monthly_electricity_bill']).toBe('₹3000 - 5000');
  });
  it('a Google lead form: column ids, ids, click id', () => {
    const l = fromGoogle({ lead_id: 'g1', campaign_id: 77, gcl_id: 'GCL', user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Kiran Shah' }, { column_id: 'PHONE_NUMBER', string_value: '9810000004' }, { column_id: 'POSTAL_CODE', string_value: '380001' }, { column_id: 'QUESTION_1', column_name: 'Roof type', string_value: 'RCC' }] });
    expect(l).toMatchObject({ name: 'Kiran Shah', phone: '9810000004', pincode: '380001', externalId: 'g1', campaign: '77', clickId: 'GCL' });
    expect(l.fields['roof_type']).toBe('RCC');
  });
});

describe('who gets the lead', () => {
  const a = 'a', b = 'b', c = 'c'; const active = new Set([a, b, c]);
  const lead = { city: 'Pune', pincode: '411001', source: 'meta', campaign: 'Solar Q4' };
  it('does nothing in manual mode', () => { expect(pickOwner('manual', [a, b], [], lead, 3, active)).toEqual({ owner: null, cursor: 3 }); });
  it('shares evenly round the default members and skips people who are no longer active', () => {
    let cur = 0; const got: (string | null)[] = [];
    for (let i = 0; i < 4; i++) { const r = pickOwner('round_robin', [a, b, 'gone'], [], lead, cur, active); got.push(r.owner); cur = r.cursor; }
    expect(got).toEqual([a, b, a, b]);
  });
  it('the first rule that fits decides the pool', () => {
    const rules = [{ match: { city: ['mumbai'] }, users: [c] }, { match: { pincodePrefix: ['411'], source: ['meta'] }, users: [b] }, { users: [a] }];
    expect(pickOwner('round_robin', [a], rules, lead, 0, active).owner).toBe(b);
    expect(pickOwner('round_robin', [a], rules, { ...lead, city: 'Mumbai', pincode: '400001' }, 0, active).owner).toBe(c);
    expect(pickOwner('round_robin', [], [], lead, 0, active).owner).toBeNull();
  });
});
