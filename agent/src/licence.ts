import type { ControlPlane } from './controlPlane.js';
import type { StateStore } from './state.js';

export interface LicencePorts {
  /** Hands a signed licence to this site's product server (it verifies the signature itself). Rejects when the server refuses it. */
  importLicence(tenantId: string, signed: { licence: unknown; signature: string }): Promise<void>;
}

/** Keeps each tenant's licence on the product server in step with the control plane. Reports how many were applied; one refusal does not stop the others. */
export async function syncLicence(cp: ControlPlane, ports: LicencePorts, state: StateStore): Promise<{ applied: number; unchanged: number; failed: string[] }> {
  const result = { applied: 0, unchanged: 0, failed: [] as string[] };
  for (const l of await cp.licences()) {
    if (state.read().appliedLicences[l.tenantId] === l.licence.licenceId) { result.unchanged++; continue; }
    try {
      await ports.importLicence(l.tenantId, { licence: l.licence, signature: l.signature });
      state.update((s) => { s.appliedLicences[l.tenantId] = l.licence.licenceId; });
      result.applied++;
    } catch (e) { result.failed.push(`${l.licence.licenceId}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return result;
}
