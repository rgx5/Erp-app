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

**Not decided yet (needs your answer):** whether retention and restore tests run centrally with an operational copy of each client's key (as above), or on each site
(no central key copy, but heavier on the site). The first is simpler and matches "we hold the keys"; it means whoever operates the cloud can read client backups.
