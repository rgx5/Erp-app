// Renders OneSyncERP-Platform-Guide.html to PDF with the installed Chromium: node docs/platform/render-pdf.cjs
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const dir = __dirname;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  await p.goto('file://' + path.join(dir, 'OneSyncERP-Platform-Guide.html'));
  await p.pdf({ path: path.join(dir, 'OneSyncERP-Platform-Guide.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;color:#888;width:100%;text-align:center">OneSyncERP · Platform guide · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
  await b.close();
})();
