import { create } from 'zustand'
import { gu } from './gu'
import { hi } from './hi'
import { mr } from './mr'

export type Lang = 'en' | 'hi' | 'mr' | 'gu'
export const LANGS: { code: Lang; name: string }[] = [{ code: 'en', name: 'English' }, { code: 'hi', name: 'हिन्दी (Hindi)' }, { code: 'mr', name: 'मराठी (Marathi)' }, { code: 'gu', name: 'ગુજરાતી (Gujarati)' }]
export const DICTIONARIES: Record<Exclude<Lang, 'en'>, Record<string, string>> = { hi, mr, gu }
const KEY = 'onesync.language'

const read = (): Lang => { try { const v = localStorage.getItem(KEY); return v === 'hi' || v === 'mr' || v === 'gu' ? v : 'en' } catch { return 'en' } }
/** The language this computer shows the app in. Remembered on the computer (a shop with a Marathi-speaking cashier can differ from the office). */
export const useLang = create<{ lang: Lang; set: (l: Lang) => void }>()((set) => ({ lang: read(), set: (lang) => { try { localStorage.setItem(KEY, lang) } catch { /* not remembered */ } set({ lang }) } }))

/** The text in a language; anything without a translation stays in English, so a screen is never blank. */
export const tr = (lang: Lang, english: string): string => (lang === 'en' ? english : DICTIONARIES[lang][english] ?? english)
/** For screens: re-renders when the language changes. */
export const useT = (): ((english: string) => string) => { const lang = useLang((s) => s.lang); return (english) => tr(lang, english) }
/** For printed documents: the current language's text, with the English beside it so a document is still readable by anyone ("टैक्स इनवॉइस / Tax Invoice"). */
export const bilingual = (english: string, lang: Lang = useLang.getState().lang): string => (lang === 'en' ? english : `${tr(lang, english)} / ${english}`)
