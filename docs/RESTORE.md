# Restoring a business from a data export

A business owner can save all their records from **Administration → Data export** (a `.json` file) and check that a saved file is whole on the same screen.
Putting a file back is an operator task, done on the server, into a **new, empty business**. Nothing is ever restored over an existing business.

## What is in the file
Every record the business has (items, customers, invoices, stock, accounts, payroll and so on) with a checksum over all of them.

Not in the file, by design:
- passwords, sign-in sessions, API keys, authenticator secrets and counter PINs (restored users cannot sign in until a password is set);
- the bytes of attached photos and documents (only their names and checksums are recorded);
- the licence and the business's web address (the operator owns these).

## Steps
1. Create the new business as usual (platform tools, or the control panel). It starts with only its own starter records.
2. Check the file: `npm run maintenance:restore -- --file export.json --verify`
3. Rehearse: `MIGRATOR_DATABASE_URL=postgres://… npm run maintenance:restore -- --file export.json --tenant <new business id> --dry-run`
   (runs the whole load and rolls it back)
4. Restore: the same command without `--dry-run`. It runs in one transaction: it all lands or none of it does.
5. Set the owner's password again, then have the owner sign in and compare a few reports with the original.

The command needs the table-owner database role (`MIGRATOR_DATABASE_URL`), because the load switches database triggers off for its duration.
It refuses a file whose checksum does not match, a target that does not exist, and a target that already has a company.

## What this is not
It is a way to bring a business back or move it, not a replacement for backups of the database itself. Server backups (pgBackRest) remain the primary protection: they capture everything, including attachments and sign-in details.
