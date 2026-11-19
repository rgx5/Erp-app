import { Agent, AGENT_VERSION } from './agent.js';
import { loadConfig } from './config.js';
import { ControlPlane } from './controlPlane.js';
import { StateStore } from './state.js';
import { Tunnel } from './tunnel.js';
import { platformPorts } from './platform.js';
import { heartbeatPorts, licencePorts, supportPorts, upgradePorts } from './system.js';

const config = loadConfig();
const state = new StateStore(config.stateFile);
const agent = new Agent({ config, cp: new ControlPlane(config.controlPlaneUrl, config.agentToken), state, heartbeat: heartbeatPorts(config), upgrade: upgradePorts(config), licence: licencePorts(config), platform: platformPorts(config), support: supportPorts(config) });
console.log(`onesync agent ${AGENT_VERSION} starting; release ${state.read().current?.version ?? 'unknown'}`);

const every = (seconds: number, fn: () => Promise<unknown>): void => { let busy = false; const tick = async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }; void tick(); setInterval(() => void tick(), seconds * 1000).unref?.(); };
every(config.heartbeatSeconds, () => agent.sendHeartbeat());
every(config.supportSeconds, async () => { await agent.supervise(); await agent.runCommands(); });
every(config.checkSeconds, async () => { await agent.syncLicence(); await agent.reportTenants(); await agent.validate(); await agent.checkRelease(); });
if (config.gatewayUrl) { const t = new Tunnel({ gatewayUrl: config.gatewayUrl, token: config.agentToken, localApiUrl: config.localApiUrl, statusFile: config.tunnelStatusFile }); t.start(); process.on('SIGTERM', () => { t.stop(); process.exit(0); }); }
process.on('SIGTERM', () => process.exit(0));
setInterval(() => undefined, 1 << 30); // keep running
