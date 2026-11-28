# Two kinds of administrator

Every business on OneSyncERP has two kinds of high-level login. They are separate accounts and the first can never become the second.

| | **Company admin** | **Super admin** |
|---|---|---|
| Who | The client's own person (the business owner, or whoever they name). It is the built-in **Owner** role. | Our own team. It is the built-in **Super admin** role. |
| Created by | The business, when it is set up (the first owner), then by that owner for anyone else. | Only us, from the platform operator endpoint. Never by the client. |
| Runs the business | Everything a company does: accounts, sales, purchases, stock, payroll, users and roles, GST, reports. | Everything the company admin can do, plus the platform tier below. |
| Platform tier | **Not available.** The owner's `*` permission does not reach `platform:*`. | `platform:licensing`, `platform:migrate`, `platform:support`. |

## What the platform tier covers

* **Licensing** (`platform:licensing`): which modules a business has paid for, its plan, limits (users, companies, locations, terminals, sites), expiry, grace days and read-only mode. Everyone who can see the organisation can *read* the licence (Settings → Licensing); only the Super admin can change it.
* **Moving from another program** (`platform:migrate`): the Vyapar and other imports that set up a business from an old system. Hidden from the company admin's menu and command search.
* **Support** (`platform:support`): reserved for tools that only our team should see.

## How the separation is enforced

* A permission starting with `platform:` is granted only by `platform:*` or by naming it. The owner's wildcard `*` does not cover it, so existing businesses lose nothing they used to have except these.
* Nobody can hand out more than they hold. A company admin cannot create a role with a platform permission, or give one to a user.
* The Super admin user and role are invisible to the company's staff: they do not appear in Users or Roles, and the company's admin gets *not found* if they try to open, change or disable the account.
* The Super admin does not count as the company's owner. A business must always keep at least one active **Owner**; our support account never satisfies that rule.
* Everything the Super admin does is recorded in the audit log like any other action.

## Creating a Super admin login for a business

The platform operator calls (with the platform token):

```
POST /v1/platform/tenants/{tenantId}/super-admin
{ "email": "support@yourcompany.example", "displayName": "OneSync Support", "password": "<at least 12 characters>" }
```

Our person then signs in on the normal sign-in screen with the business code, that email and password. There is no client-facing way to create this account.

## Known limits

* Hiding the migration screens is done in the app (menu, command search). The import itself writes through the normal business APIs, so the server does not yet refuse a company admin who calls those directly.
* Licensing is enforced by the server (a company admin's change request is refused).
