import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15];
const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const key = (labels: Labels): string => Object.keys(labels).sort().map((k) => `${k}="${esc(labels[k] as string)}"`).join(',');

/** A tiny in-process metrics registry that renders the Prometheus text format. Labels must stay low-cardinality (route templates, never ids). */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, { help: string; values: Map<string, number> }>();
  private readonly histograms = new Map<string, { help: string; values: Map<string, { buckets: number[]; sum: number; count: number }> }>();
  private readonly gauges: (() => Promise<{ name: string; help: string; samples: { labels?: Labels; value: number }[] }[]>)[] = [];

  inc(name: string, help: string, labels: Labels = {}, by = 1): void {
    const c = this.counters.get(name) ?? { help, values: new Map() };
    this.counters.set(name, c);
    const k = key(labels);
    c.values.set(k, (c.values.get(k) ?? 0) + by);
  }

  observe(name: string, help: string, labels: Labels, seconds: number): void {
    const h = this.histograms.get(name) ?? { help, values: new Map() };
    this.histograms.set(name, h);
    const k = key(labels);
    const v = h.values.get(k) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    h.values.set(k, v);
    BUCKETS.forEach((b, i) => { if (seconds <= b) v.buckets[i] = (v.buckets[i] as number) + 1; });
    v.sum += seconds; v.count += 1;
  }

  /** Registers values read fresh at every scrape (pool use, backup age, outbox lag...). */
  gauge(read: () => Promise<{ name: string; help: string; samples: { labels?: Labels; value: number }[] }[]>): void { this.gauges.push(read); }

  async render(): Promise<string> {
    const out: string[] = [];
    for (const [name, c] of this.counters) {
      out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
      for (const [k, v] of c.values) out.push(`${name}${k ? `{${k}}` : ''} ${v}`);
    }
    for (const [name, h] of this.histograms) {
      out.push(`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`);
      for (const [k, v] of h.values) {
        const l = k ? `${k},` : '';
        BUCKETS.forEach((b, i) => out.push(`${name}_bucket{${l}le="${b}"} ${v.buckets[i]}`));
        out.push(`${name}_bucket{${l}le="+Inf"} ${v.count}`, `${name}_sum${k ? `{${k}}` : ''} ${v.sum}`, `${name}_count${k ? `{${k}}` : ''} ${v.count}`);
      }
    }
    for (const read of this.gauges) {
      try {
        for (const g of await read()) {
          out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
          for (const s of g.samples) out.push(`${g.name}${s.labels ? `{${key(s.labels)}}` : ''} ${s.value}`);
        }
      } catch { /* a gauge that cannot be read is left out rather than failing the scrape */ }
    }
    return out.join('\n') + '\n';
  }
}
