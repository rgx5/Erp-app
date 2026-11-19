# Quality, usability and security review

Date: 2026-11-19. Scope: the desktop app, the product API (backend), the control plane and super admin dashboard, the gateway, the fleet agent, the owner web dashboard, and the Dokploy deployment files. Method: automated suites, a crawl of every screen of the real app with fully seeded data, accessibility scanning (axe-core), and scripted attacks against the running servers. This was done by the development team's tooling, not by an independent penetration tester.

## 1. Functionality

| Check | Result |
|---|---|
| Backend: type check, lint, 107 unit tests, 468 integration tests (real PostgreSQL, row-level security) | pass |
| Control plane (43 tests), gateway (17), agent (42, including real PostgreSQL 16 + pgBackRest backup and restore) | pass |
| Desktop app: type check, lint, 68 unit tests, 15 tests against the live backend | pass |
| Desktop app: 27 browser journeys (sales, purchasing, inventory, accounting, GST, payroll, manufacturing, POS, retail, admin, licence, editions, setup) | pass |
| Desktop app: 3 Electron shell tests (own origin, sign-in, PDF) | pass |
| Crawl of all 60 screens as the owner of a fully seeded business, at 1440x900 and 1024x700 | 0 crashes, 0 failed API calls, 0 blank screens, 0 sideways scrolling |

## 2. Usability and accessibility

Found and fixed:

- **171 accessibility violations across the app, now 0** on all 60 screens at both sizes. Causes: low-contrast greys and status colours (the same hues, slightly darker where below 4.5:1), data grid column headers with the wrong ARIA roles, invoice and journal line grids announced as tables without cells, an empty definition list, empty table headers, an account menu whose accessible name did not match its text, a payroll button whose label did not match its text.
- **Drawers and overlays covered only the page content height** (reported by the owner): a page fade-in animated `transform`, which made the page the reference frame for fixed panels. Now fades opacity only.
- **Data grids silently cut off columns on narrow windows** (Items at 1024px lost Brand, MRP, Unit, Status). Grids now scroll sideways.
- **At 1024px (small laptop, counter tablet):** the top bar wrapped "Point of sale" onto three lines; the Counter toolbar ran off the edge and hid a button; form fields overflowed their cards in the payment panel. Fixed.
- Control panel: same contrast, unlabelled checkboxes and empty header fixes; sign-in screens and the owner page got proper headings and a main landmark. Control panel and owner page now scan clean.

Not tested: screen readers by hand, right-to-left text, mobile phones (the app is a desktop product; the owner page is responsive but was only checked at desktop and narrow-laptop widths), very large font settings.

## 3. Security

Scripted checks against running servers:

| Area | What was tried | Result |
|---|---|---|
| API, no sign-in | all 355 operations | all refused (401/403/404) |
| API, least privilege | all operations as a user who may only read the organisation | 330 refused, 0 server errors, no writes allowed |
| Tenant isolation | 49 record reads and 49 writes from a second business against the first business's real ids; list endpoints | 0 leaks |
| Tokens | tampered payload, `alg: none`, truncated signature, garbage, expired | all refused |
| Sessions | sign-out; refresh token rotation and replay | immediate; replay revokes the whole family |
| Brute force | repeated wrong passwords | account locks; unknown and known users give identical errors |
| Hostile input | 183 requests with SQL-injection, script, traversal, huge and null-byte text in queries and bodies; 3 MB body | 0 server errors; 413 for the large body |
| Stored XSS | a customer, item and invoice named `<img onerror=...>` shown in lists, pickers, palette, reports and the owner dashboard | rendered as text; no script ran |
| Platform routes | no token, a tenant owner's token, a wrong token | all refused |
| Control plane | all routes unauthenticated; viewer and support attempting writes and admin actions; one cell's agent token against another cell's data; claiming another cell's business; forged agent and gateway tokens; staff brute force | all refused or isolated |
| Gateway | path traversal and encoded variants; `X-Forwarded-For` spoofing | traversal refused; **spoofing was possible, fixed (below)** |
| Electron | window flags, IPC sender checks, navigation and window-open guards | already strong; hardened (below) |
| Dependencies | `npm audit` on all five packages | 0 vulnerabilities in anything that ships; only build-tool advisories (esbuild dev server, minimatch at build time) |
| Secrets | scan of current files and full history for keys, tokens, `.env` files | none committed |

Found and fixed:

1. **Gateway trusted a visitor-supplied `X-Forwarded-For`**, so someone could pretend to come from a client's allowed network and bypass the "allowed networks" rule. Now only the address seen by the nearest trusted proxy is believed (`TRUSTED_PROXY_HOPS`, default 1 for Dokploy's Traefik, 2 behind a CDN as well). Regression test added.
2. **The control panel sent no security headers**: it could be embedded in another site (clickjacking against actions such as suspending a business). Added `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, a strict `Content-Security-Policy` on the dashboard page, and `no-store` caching. Test added.
3. **Desktop app hardening:** every browser permission prompt is refused; `<webview>` is blocked; a real `Content-Security-Policy` header (the meta tag cannot carry `frame-ancestors`); developer tools disabled in packaged builds; Electron fuses set (`runAsNode`, `NODE_OPTIONS` and `--inspect` off, load only from the app archive, no extra `file://` privileges). The packaged Linux build was launched with the fuses applied.

## 4. Known gaps and recommendations (not fixed)

- **No rate limit on the product API.** It exists but is off by default, and behind a proxy all traffic shares one address, so it cannot be enabled as is. Put a rate limit in Traefik (Dokploy middleware) or a firewall. Login lockout already protects passwords.
- **Secrets live in environment variables** (visible to anyone who can inspect the containers or open the Dokploy environment tab). Fine for a demo; use Docker or Dokploy secrets and rotate keys for production. The demo env files that were shared in chat should be treated as compromised for any real use.
- **HSTS and TLS** come from the proxy; they are not tested here.
- **Installers are unsigned** (SmartScreen and Gatekeeper warnings, no tamper protection beyond the published checksums). No auto-update.
- **The API explorer (`/docs`)** is on in development and off in production (`NODE_ENV=production`); confirm on the demo server.
- **Add to CI:** `npm audit --omit=dev` on each package, and dependency update PRs.

## 5. Not covered by this review

Load and performance (the 50 to 100 client target is untested), the Docker images and Dokploy/Traefik behaviour (no Docker daemon was available; CI builds them but had not run when this was written), real Windows and macOS installers' runtime behaviour, real printers and barcode scanners, the GST portal, restore drills on real hardware, an independent penetration test, and social engineering or operational security.
