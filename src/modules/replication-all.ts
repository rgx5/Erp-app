/**
 * The pure half of every module — its collections, permissions and effects — with nothing from React or Expo. The Kosh
 * server imports this file (and only this) to learn what each collection is and what posting a document does. Each module's
 * `index.ts` imports its own `replication.ts` too, so the app and the server always agree.
 */
import '@/replication'
import './accounting/replication'
import './admin-core/replication'
import './admin-platform/replication'
import './catalog/replication'
import './credit/replication'
import './crm/replication'
import './hr/replication'
import './industry-food/replication'
import './industry-retail/replication'
import './manufacturing/replication'
import './pricing/replication'
import './purchasing/replication'
import './reports-plus/replication'
import './sales-docs/replication'
import './services/replication'
import './tax/replication'
import './warehouse/replication'
