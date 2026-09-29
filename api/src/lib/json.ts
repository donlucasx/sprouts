/** JSON with bigints as decimal strings: what every app-facing route answers. */
export const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
