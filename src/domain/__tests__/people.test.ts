import { firstName } from '../people'

describe('firstName', () => {
  test('takes the first word', () => {
    expect(firstName('Meera Iyer')).toBe('Meera')
    expect(firstName('  Rakesh   Sharma ')).toBe('Rakesh')
  })
  test('skips a leading title', () => {
    expect(firstName('Dr. Meera Iyer')).toBe('Meera')
    expect(firstName('Mrs Kavita Rao')).toBe('Kavita')
    expect(firstName('Shri Anand')).toBe('Anand')
  })
  test('copes with nothing, or only a title', () => {
    expect(firstName('')).toBe('')
    expect(firstName(undefined)).toBe('')
    expect(firstName('Dr.')).toBe('Dr.')
  })
})
