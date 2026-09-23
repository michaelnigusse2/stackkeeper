/**
 * What a jsonb column can actually hold.
 *
 * These columns were typed `Record<string, unknown>`, which says "an object
 * with string keys" and nothing at all about the values. `unknown` covers a
 * symbol, a bigint, a function, a class instance with private fields -- none
 * of which survive `JSON.stringify`, and two of which throw. The driver is
 * stricter than we were, so every `sql.json(...)` call was rejected.
 *
 * Saying it properly costs one type and buys a real check at the edge: a Date
 * dropped into a payload is now caught here rather than silently stored as
 * whatever `JSON.stringify` felt like emitting.
 *
 * Arrays are `readonly` so that a `readonly string[]` coming out of a parser
 * can be stored without being copied first. Objects are not, because payloads
 * are routinely built a key at a time.
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A jsonb column: an object at the top level, and writable while it is built. */
export type JsonObject = { [key: string]: JsonValue };
