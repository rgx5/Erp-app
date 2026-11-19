import { readFileSync } from 'node:fs';

export interface AgentConfig {
  controlPlaneUrl: string; agentToken: string; releasePublicKey: string;
  stateFile: string; dataDir: string; localApiUrl: string; platformAdminToken: string;
  registry: string; composeFile: string; releaseEnvFile: string; migratorEnvFile: string; dockerNetwork: string;
  backupCommand: string; restoreCommand: string; backupStatusFile: string; tunnelStatusFile: string;
  supportAuthorizedKeys: string; supportCodeFile: string;
  /** The gateway to open the remote-access tunnel to (Hybrid sites). Absent: no tunnel. */
  gatewayUrl: string | undefined;
  heartbeatSeconds: number; checkSeconds: number; supportSeconds: number; retryFailedUpgradeHours: number;
}
const need = (env: NodeJS.ProcessEnv, k: string): string => { const v = env[k]; if (!v) throw new Error(`${k} is required`); return v; };
/** A secret is given directly or, better, as a path to a file only the agent can read (NAME_FILE). */
const secret = (env: NodeJS.ProcessEnv, k: string): string => (env[`${k}_FILE`] ? readFileSync(need(env, `${k}_FILE`), 'utf8').trim() : need(env, k));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    controlPlaneUrl: need(env, 'CONTROL_PLANE_URL').replace(/\/$/, ''), agentToken: secret(env, 'AGENT_TOKEN'), releasePublicKey: env['RELEASE_PUBLIC_KEY_FILE'] ? readFileSync(env['RELEASE_PUBLIC_KEY_FILE'], 'utf8') : need(env, 'RELEASE_PUBLIC_KEY'),
    stateFile: env['STATE_FILE'] ?? '/var/lib/onesync/agent-state.json', dataDir: env['DATA_DIR'] ?? '/var/lib/onesync', localApiUrl: (env['LOCAL_API_URL'] ?? 'http://127.0.0.1:8080').replace(/\/$/, ''), platformAdminToken: secret(env, 'PLATFORM_ADMIN_TOKEN'),
    registry: need(env, 'IMAGE_REGISTRY'), composeFile: env['COMPOSE_FILE'] ?? '/opt/onesync/docker-compose.site.yml', releaseEnvFile: env['RELEASE_ENV_FILE'] ?? '/etc/onesync/release.env', migratorEnvFile: env['MIGRATOR_ENV_FILE'] ?? '/etc/onesync/migrator.env', dockerNetwork: env['DOCKER_NETWORK'] ?? 'onesync_default',
    backupCommand: env['BACKUP_COMMAND'] ?? '/usr/local/bin/onesync-backup', restoreCommand: env['RESTORE_COMMAND'] ?? '/usr/local/bin/onesync-restore', backupStatusFile: env['BACKUP_STATUS_FILE'] ?? '/var/lib/onesync/backup-status.json', tunnelStatusFile: env['TUNNEL_STATUS_FILE'] ?? '/var/lib/onesync/tunnel-status.json',
    supportAuthorizedKeys: env['SUPPORT_AUTHORIZED_KEYS'] ?? '/home/onesync-support/.ssh/authorized_keys', supportCodeFile: env['SUPPORT_CODE_FILE'] ?? '/var/lib/onesync/support-code',
    gatewayUrl: env['GATEWAY_URL']?.replace(/\/$/, ''),
    heartbeatSeconds: Number(env['HEARTBEAT_SECONDS'] ?? 60), checkSeconds: Number(env['CHECK_SECONDS'] ?? 300), supportSeconds: Number(env['SUPPORT_SECONDS'] ?? 15), retryFailedUpgradeHours: Number(env['RETRY_FAILED_UPGRADE_HOURS'] ?? 6),
  };
}
