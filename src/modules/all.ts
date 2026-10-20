/**
 * Every module's UI registration, in one list. Core comes first so the eleven apps exist before anything adds to them.
 * Each module's `index.ts` registers its apps, panels and hooks and imports its own `replication.ts`.
 */
import './core'
import './accounting'
import './admin-core'
import './admin-platform'
import './catalog'
import './credit'
import './crm'
import './hr'
import './industry-food'
import './industry-retail'
import './manufacturing'
import './pricing'
import './purchasing'
import './reports-plus'
import './sales-docs'
import './services'
import './tax'
import './warehouse'
