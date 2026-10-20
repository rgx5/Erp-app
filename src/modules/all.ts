/**
 * Every module's UI registration, in one list. A module adds itself by creating `src/modules/<dir>/index.ts` (which calls
 * `registerModule`, `registerPanel`… and imports its own `replication.ts`) and listing it here. Core comes first so the
 * eleven apps exist before anything adds to them.
 */
import './core'
// Modules are listed below, one import per line (kept sorted).
