import z from "zod"
import { BusEvent } from "./bus-event.js"

export namespace Bus {
  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({ directory: z.string() }),
  )

  export async function publish<Definition extends BusEvent.Definition>(
    _def: Definition,
    _properties: z.output<Definition["properties"]>,
  ) {
    return
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    _def: Definition,
    _callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return () => {}
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) =>
      | "done"
      | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
  }

  export function subscribeAll(_callback: (event: any) => void) {
    return () => {}
  }
}
