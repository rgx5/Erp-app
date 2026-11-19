# OneSyncERP remote-access gateway (level C)

Lets an owner use the product from outside the office. The site's server opens an **outbound** HTTPS (WebSocket) tunnel to this gateway; remote users reach
`<client>.remote.example.in`; the gateway carries each request through that tunnel to the site's own server and carries the reply back. There is one database
(the site's), so nothing is copied and there is nothing to merge. Sign-in, passwords and two-step codes are all checked by the site's server.

## Why an HTTPS tunnel (decision for the open tunnel question)

| | HTTPS/WebSocket tunnel (built) | WireGuard |
|---|---|---|
| Through office firewalls and proxies | Works anywhere outbound HTTPS works | UDP is often blocked; needs router changes at some sites |
| Per-site revocation | Instant (control plane says no at the next check) | Remove a peer from the gateway |
| Operations | One small process, no kernel setup, no root on the site | Kernel module/config, key rotation, peer management |
| Control of what is reachable | The gateway and the client both allow only `/v1/*` and `/health/live`, never `/v1/platform/*` | Whole network path unless firewalled |
| Cost | Slightly more overhead per request (not a problem for API traffic) | Lowest overhead |

WireGuard stays available for staff-to-site support access later; it is not needed for client remote use.

## What it enforces

- The tunnel token is the site's agent token; the **control plane decides** (`POST /gateway/verify`): the site must have a remote address, remote access switched on, a Hybrid or Hybrid Plus client, and an active client. It re-checks every minute; an unreachable control plane never drops a live tunnel.
- One tunnel per site (the newest wins); `/v1/platform/*`, path tricks (`..`, `//`, encoded dots/slashes), and anything outside `/v1/*` and `/health/live` get 404 before reaching the site.
- Per-site request rate and in-flight limits, body size limit, timeouts (504), and a clear 503 `site_offline` when the office server is not connected.
- The gateway stores no business data. It sees traffic in transit (it terminates TLS here so it can apply these rules): record that in the data processing agreement.

## Run it

```
CONTROL_PLANE_URL=https://control.example.in GATEWAY_TOKEN=<same as the control plane's GATEWAY_TOKEN> npm start   # listens on 127.0.0.1:8443
```
Put Caddy (see `deploy/Caddyfile`) in front for TLS. On the control plane, give each site an address (`PATCH /sites/:id {"hostname": "pune.remote.example.in"}`); the site's agent opens the tunnel when `GATEWAY_URL` is set.

## Tests

`npm test`: real tunnel client and gateway with a stand-in site server (forwarding, blocked paths, isolation, streaming 5 MB, revocation, limits, timeouts, reconnection), plus `test/chain.test.ts` with the real control plane. Needs PostgreSQL for the chain test.

## Not built yet

Per-client remote rules (by role, time, country; force read-only for some roles), the desktop app's local-first/remote fallback, and the owner web dashboard.
