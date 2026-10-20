/**
 * The pure half of every module — its collections, permissions and effects — with nothing from React or Expo. The Kosh
 * server imports this file (and only this) to learn what each collection is and what posting a document does. Each module's
 * `index.ts` imports its own `replication.ts` too, so the app and the server always agree.
 */
import '@/replication'
// Modules are listed below, one import per line (kept sorted).
