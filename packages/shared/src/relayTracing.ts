import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

export interface RelayClientTracingConfig {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
}
export interface RelayClientTracingResource {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly runtime: string;
  readonly client: string;
  readonly component?: string;
}
export class RelayClientTracer extends Context.Reference(
  "@t3tools/shared/relayTracing/RelayClientTracer",
  {
    defaultValue: () => Option.none<Tracer.Tracer>(),
  },
) {}

export const withRelayClientTracing = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
export const withLocalTracing = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;

/** Compatibility layer: configured endpoints and tokens cannot enable export. */
export function layer(
  _config: RelayClientTracingConfig | null,
  _resource: RelayClientTracingResource,
) {
  return Layer.succeed(RelayClientTracer, Option.none());
}
