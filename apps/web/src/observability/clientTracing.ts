import * as ClientTracer from "./clientTracer";

export interface ClientTracingConfig {
  readonly exportIntervalMs?: number;
}

/** Keep local tracing, but never install a network exporter. */
export function configureClientTracing(_config: ClientTracingConfig = {}): Promise<void> {
  ClientTracer.setDelegate(null);
  return Promise.resolve();
}
