# Cloud side of backups

**Repository**: an S3-compatible store (MinIO on the Hostinger backup server, and a second bucket at another provider). Each site has its own access key
using `minio-site-policy.json`: it may add and read objects under `clients/<its path>` but **cannot delete or change the policy**, so a hacked or
ransomware-infected site cannot erase its own history. Turn on bucket versioning and object lock where the store supports it.

**Retention** (`pgbackrest expire`) runs only from here, with administrator credentials, because sites run with `expire-auto=n`:

    for each client: pgbackrest --config=<client conf> --stanza=onesync expire

It needs the client's backup key, because backup metadata is encrypted. Keep the operational copy of each key in the cloud secret manager and let only the
retention/verification jobs read it. The sealed escrow (control plane `POST /sites/:id/backup-key`, opened only with two custodians) is for disaster recovery.

**Checks that must run on a schedule** (alert on failure; the fleet screen already alerts when a site's last log shipment or base backup is late):

- nightly: `onesync-backup backup verify` against every repository of a sample of sites;
- monthly: `backup-cli restore-test` on the verification host for a rotating sample of clients (restores to a scratch database with archiving off, checks the books balance).

**Decision taken (change it if you disagree):** retention, verification and restore tests run centrally from the cloud with each client's key fetched from the secret manager at run time (`keyCommand`), not stored on disk. This matches "we hold the keys"; it means whoever operates the cloud jobs can read client backups, so restrict and audit access to that host and the secret manager. The alternative (jobs on each site) avoids that but loads the site.

**Setup:** one JSON file per client in `/etc/onesync-cloud/clients/`:

    { "site": "PUNE-01", "stanza": "onesync", "configFile": "/etc/onesync-cloud/pgbackrest/PUNE-01.conf", "repoCount": 2, "keyCommand": ["vault", "kv", "get", "-field=key", "secret/clients/PUNE-01"] }

Then enable the timers here (`onesync-cloud-expire`, `-verify`, `-restore-test`). Each job prints a JSON report and exits non-zero if any client failed: alert on that.
