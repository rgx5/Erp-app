import { Agent, AGENT_VERSION } from './agent.js';
import { loadConfig } from './config.js';
import { ControlPlane } from './controlPlane.js';
import { StateStore } from './state.js';
import { heartbeatPorts, licencePorts, supportPorts, upgradePorts } from './system.js';

const config = loadConfig();
const state = new StateStore(config.stateFile);
const agent = new Agent({ config, cp: new ControlPlane(config.controlPlaneUrl, config.agentToken), state, heartbeat: heartbeatPorts(config), upgrade: upgradePorts(config), licence: licencePorts(config), support: supportPorts(config) });
console.log(`onesync agent ${AGENT_VERSION} starting; release ${state.read().current?.version ?? 'unknown'}`);

const every = (seconds: number, fn: () => Promise<unknown>): void => { let busy = false; const tick = async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }; void tick(); setInterval(() => void tick(), seconds * 1000).unref?.(); };
every(config.heartbeatSeconds, () => agent.sendHeartbeat());
every(config.supportSeconds, () => agent.supervise());
every(config.checkSeconds, async () => { await agent.syncLicence(); await agent.checkRelease(); });
process.on('SIGTERM', () => process.exit(0));
setInterval(() => undefined, 1 << 30); // keep running
