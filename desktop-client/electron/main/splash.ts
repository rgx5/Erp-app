const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const LOGO = `<svg viewBox="0 0 1254 1254" width="84" height="84" xmlns="http://www.w3.org/2000/svg"><rect x="63" y="67" width="1127" height="1123" rx="215" fill="#0449f7"/><g fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"><path d="M652 323A351 351 0 1 0 972 642L860 642A239 239 0 1 1 652 451Z"/><path d="M660 272L660 526L824 400Z"/></g><rect x="842" y="441" width="168" height="166" rx="42" fill="#ff981f"/></svg>`

/** The window shown while the app starts: the mark, the name, the version and a moving bar. Scripts are off; this is plain HTML and CSS. */
export function splashHtml(version: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>OneSyncERP</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;-webkit-app-region:drag;user-select:none}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#1d2433;
background:radial-gradient(circle at 50% 0%,#eef3ff 0%,#ffffff 62%);border:1px solid #dfe4ee;border-radius:10px}
h1{margin:6px 0 0;font-size:22px;letter-spacing:-.3px}.sub{color:#5b6475;font-size:12.5px}
.bar{position:absolute;left:60px;right:60px;bottom:54px;height:4px;border-radius:4px;background:#e6ebf5;overflow:hidden}
.bar i{display:block;height:100%;width:38%;border-radius:4px;background:#0449f7;animation:run 1.25s ease-in-out infinite}
@keyframes run{0%{margin-left:-40%}100%{margin-left:102%}}
.ver{position:absolute;bottom:16px;color:#8a92a3;font-size:11.5px}
@media (prefers-reduced-motion:reduce){.bar i{animation:none;margin-left:31%}}
</style></head><body>${LOGO}<h1>OneSyncERP</h1><div class="sub">Starting up…</div><div class="bar"><i></i></div><div class="ver">Version ${esc(version)}</div></body></html>`
}

/** Shown in place of the app when its own page could not be loaded. The button asks the shell to try again. */
export function loadErrorHtml(reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>OneSyncERP</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1d2433;background:#f3f5f9;text-align:center;padding:24px}
h1{font-size:20px;margin:0}p{color:#5b6475;max-width:420px;margin:0}code{font-size:12px;color:#8a92a3}
a{margin-top:8px;display:inline-block;background:#0449f7;color:#fff;text-decoration:none;padding:9px 18px;border-radius:6px;font-weight:600}</style></head>
<body>${LOGO}<h1>OneSyncERP could not start</h1><p>Something stopped the app from loading. Closing it and opening it again usually fixes this. If it keeps happening, send the log file from Help, Open log folder to your administrator.</p><code>${esc(reason)}</code><a href="app://retry">Try again</a></body></html>`
}
