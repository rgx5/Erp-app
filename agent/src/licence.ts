import type { ControlPlane } from './controlPlane.js';
import type { StateStore } from './state.js';

export interface LicencePorts {
  /** Hands a signed licence to this site's product server (it verifies the signature itself). Rejects when the server refuses it. */
  importLicence(tenantId: string, signed: { licence: unknown; signature: string }): Promise<void>;
}

/** Keeps the product server's licence in step with the control plane. Returns what happened, for the log. */
export async function syncLicence(cp: ControlPlane, ports: LicencePorts, state: StateStore): Promise<'applied' | 'unchanged' | 'none'> {
  const latest = await cp.licence();
  if (!latest) return 'none';
  if (state.read().appliedLicenceId === latest.licence.licenceId) return 'unchanged';
  await ports.importLicence(latest.tenantId ?? latest.licence.tenantId, { licence: latest.licence, signature: latest.signature });
  state.update((s) => { s.appliedLicenceId = latest.licence.licenceId; });
  return 'applied';
}
