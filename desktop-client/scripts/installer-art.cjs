/* Draws the installer artwork (Windows wizard sidebar and header, macOS disk-image background) from the brand mark.
 * Run: node scripts/installer-art.cjs   (needs Playwright's Chromium and Python Pillow for the .bmp conversion; the results are committed in build/). */
const { chromium } = require('playwright')
const { writeFileSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const LOGO = (px) => `<svg viewBox="0 0 1254 1254" width="${px}" height="${px}" xmlns="http://www.w3.org/2000/svg"><rect x="63" y="67" width="1127" height="1123" rx="215" fill="#0449f7"/><g fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"><path d="M652 323A351 351 0 1 0 972 642L860 642A239 239 0 1 1 652 451Z"/><path d="M660 272L660 526L824 400Z"/></g><rect x="842" y="441" width="168" height="166" rx="42" fill="#ff981f"/></svg>`
const fontData = require('node:fs').readFileSync(join(__dirname, '..', 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64')
const FACE = `@font-face{font-family:'ArtInter';src:url(data:font/woff2;base64,${fontData}) format('woff2');font-weight:100 900}`
const FONT = "'ArtInter',sans-serif"
const pages = {
  // 164 x 314: the tall panel on the left of the welcome and finish pages
  'installerSidebar': { w: 164, h: 314, html: `<div style="width:164px;height:314px;background:linear-gradient(160deg,#0449f7 0%,#0338c4 65%,#022a94 100%);position:relative;overflow:hidden;font-family:${FONT};color:#fff">
    <div style="position:absolute;right:-50px;top:-50px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.10)"></div>
    <div style="position:absolute;left:-40px;bottom:-60px;width:170px;height:170px;border-radius:50%;background:rgba(255,255,255,.06)"></div>
    <div style="position:absolute;left:20px;top:34px">${LOGO(58)}</div>
    <div style="position:absolute;left:20px;top:108px;font-size:19px;font-weight:700;letter-spacing:-.3px;color:#fff">OneSyncERP</div>
    <div style="position:absolute;left:20px;top:136px;right:16px;font-size:11.5px;line-height:1.45;color:rgba(255,255,255,.88)">Sell, buy, stock, accounts, GST and payroll in one place.</div>
    <div style="position:absolute;left:20px;bottom:16px;font-size:10px;color:rgba(255,255,255,.65)">© OneSyncERP</div></div>` },
  // 150 x 57: the strip at the top of the inner pages
  'installerHeader': { w: 150, h: 57, html: `<div style="width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;box-sizing:border-box;font-family:${FONT}">${LOGO(38)}</div>` },
  'dmg-background': { w: 660, h: 400, scale: 2, html: `<div style="width:660px;height:400px;background:linear-gradient(180deg,#f7f9ff 0%,#e9efff 100%);position:relative;font-family:${FONT};color:#1d2433">
    <div style="position:absolute;left:0;right:0;top:34px;text-align:center;font-size:22px;font-weight:700;letter-spacing:-.3px">Install OneSyncERP</div>
    <div style="position:absolute;left:0;right:0;top:66px;text-align:center;font-size:13px;color:#5b6475">Drag OneSyncERP into your Applications folder</div>
    <svg style="position:absolute;left:272px;top:170px" width="116" height="44" viewBox="0 0 116 44"><path d="M4 22H96M80 6l18 16-18 16" fill="none" stroke="#0449f7" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 0"/></svg></div>` },
}
;(async () => {
  const out = join(__dirname, '..', 'build'); mkdirSync(out, { recursive: true })
  const exe = '/opt/pw-browsers/chromium'
  const browser = await chromium.launch(require('node:fs').existsSync(exe) ? { executablePath: exe } : {})
  for (const [name, p] of Object.entries(pages)) {
    for (const scale of p.scale ? [1, p.scale] : [1]) {
      const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: scale })
      await page.setContent(`<style>${FACE}</style><body style="margin:0">${p.html}</body>`)
      await page.evaluate(() => document.fonts.ready)
      const file = join(out, `${name}${scale > 1 ? '@2x' : ''}.png`)
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: p.w, height: p.h } }); await page.close()
    }
  }
  await browser.close()
  // the Windows installer reads 24-bit BMP files
  const py = 'from PIL import Image\nimport sys\nfor n in sys.argv[2:]:\n    Image.open(sys.argv[1]+"/"+n+".png").convert("RGB").save(sys.argv[1]+"/"+n+".bmp")\n'
  execFileSync('python3', ['-c', py, out, 'installerSidebar', 'installerHeader'])
  writeFileSync(join(out, '.art-generated'), new Date().toISOString())
  console.log('done')
})()
