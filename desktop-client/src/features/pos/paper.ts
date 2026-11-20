/** The receipt roll this computer prints on. Kept on the computer (not the server) because it belongs to the printer. */
export type Paper = '58' | '80'
const KEY = 'onesync.receiptPaper'
export const getPaper = (): Paper => { try { return localStorage.getItem(KEY) === '58' ? '58' : '80' } catch { return '80' } }
export const setPaper = (p: Paper): void => { try { localStorage.setItem(KEY, p) } catch { /* not remembered */ } }
/** Page and text sizes for a roll: a 58 mm roll prints about 48 mm wide, an 80 mm roll about 72 mm. */
export const paperCss = (p: Paper): string => (p === '58' ? '@page{size:58mm auto;margin:3mm}body{font:10px/1.3 ui-monospace,Menlo,monospace;color:#000;width:50mm}' : '@page{size:80mm auto;margin:4mm}body{font:11px/1.35 ui-monospace,Menlo,monospace;color:#000;width:72mm}')
