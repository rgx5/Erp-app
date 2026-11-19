/** One place backups are kept. The first is the cloud repository we run, the second a separate provider, the third (optional) a disk at the site. */
export type Repo =
  | { type: 'posix'; path: string }
  | { type: 's3'; bucket: string; endpoint: string; region: string; keyFile: string; secretFile: string; path: string }
  | { type: 'sftp'; host: string; user: string; keyFile: string; path: string };

export interface BackupConfig {
  stanza: string;
  pgDataPath: string;
  pgSocketPath: string;
  pgPort: number;
  pgUser: string;
  repos: Repo[];
  /** The key for this client's backups. Backups are encrypted on the site; the repository only ever holds ciphertext. */
  cipherPassFile: string;
  /** A new log segment is forced at least this often, which is what bounds how much recent work could be lost. */
  archiveTimeoutSeconds: number;
  fullRetention: number;
}

const kv = (k: string, v: string | number): string => `${k}=${v}`;
/**
 * The pgBackRest configuration for a site. It contains the repository key and any S3 keys (read from the key files), so the file MUST be written
 * readable by the database user only (mode 0600): the database server's own log-shipping command needs them. The site only ever
 * adds backups: it does not expire old ones (expire-auto=n); retention runs from the cloud side with separate credentials, so a hacked
 * site cannot erase its own history.
 */
export function pgbackrestConf(c: BackupConfig, read: (file: string) => string): string {
  const pass = read(c.cipherPassFile).trim();
  const lines = ['[global]', kv('compress-type', 'zst'), kv('compress-level', 3), kv('start-fast', 'y'), kv('archive-async', 'y'), kv('expire-auto', 'n'), kv('log-level-console', 'warn'), kv('process-max', 2)];
  c.repos.forEach((r, i) => {
    const n = i + 1;
    lines.push(kv(`repo${n}-path`, r.path), kv(`repo${n}-cipher-type`, 'aes-256-cbc'), kv(`repo${n}-cipher-pass`, pass));
    if (r.type === 'posix') lines.push(kv(`repo${n}-type`, 'posix'));
    if (r.type === 's3') lines.push(kv(`repo${n}-type`, 's3'), kv(`repo${n}-s3-bucket`, r.bucket), kv(`repo${n}-s3-endpoint`, r.endpoint), kv(`repo${n}-s3-region`, r.region), kv(`repo${n}-s3-uri-style`, 'path'), kv(`repo${n}-s3-key`, read(r.keyFile).trim()), kv(`repo${n}-s3-key-secret`, read(r.secretFile).trim()));
    if (r.type === 'sftp') lines.push(kv(`repo${n}-type`, 'sftp'), kv(`repo${n}-sftp-host`, r.host), kv(`repo${n}-sftp-host-user`, r.user), kv(`repo${n}-sftp-private-key-file`, r.keyFile));
    lines.push(kv(`repo${n}-retention-full`, c.fullRetention));
  });
  lines.push('', `[${c.stanza}]`, kv('pg1-path', c.pgDataPath), kv('pg1-socket-path', c.pgSocketPath), kv('pg1-port', c.pgPort), kv('pg1-user', c.pgUser));
  return `${lines.join('\n')}\n`;
}

/** The PostgreSQL settings that make it ship every finished log segment, and force one at least every archive-timeout seconds. */
export function postgresArchiveSettings(c: Pick<BackupConfig, 'stanza' | 'archiveTimeoutSeconds'>, configFile?: string): string {
  const cfg = configFile ? ` --config=${configFile}` : '';
  return ['wal_level = replica', 'archive_mode = on', `archive_command = 'pgbackrest${cfg} --stanza=${c.stanza} archive-push %p'`, `archive_timeout = ${c.archiveTimeoutSeconds}`, 'max_wal_senders = 4', ''].join('\n');
}
