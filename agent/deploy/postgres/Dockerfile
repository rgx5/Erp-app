# The site database image: PostgreSQL 16 with pgBackRest, so the database server can ship its own log and the agent can back it up.
FROM postgres:16
RUN apt-get update && apt-get install -y --no-install-recommends pgbackrest && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /var/lib/pgbackrest /var/log/pgbackrest /var/lib/onesync/backup-repo \
 && chown -R postgres:postgres /etc/pgbackrest /var/lib/pgbackrest /var/log/pgbackrest /var/lib/onesync/backup-repo
