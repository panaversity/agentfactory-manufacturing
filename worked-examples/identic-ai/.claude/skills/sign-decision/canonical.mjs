// canonical.mjs - RFC-8785 (JCS) canonical JSON.
// Sort object keys lexicographically (by UTF-16 code unit, which is what
// Array.prototype.sort does by default and what JCS specifies), emit no
// insignificant whitespace, and serialize numbers/strings per JSON.
// Signer and verifier MUST both canonicalize this way or signatures will not match.
//
// Scope note: this handles the object/array/string/boolean/null and
// integer/simple-decimal number shapes a decision payload uses. Full RFC-8785
// number serialization (the ECMAScript Number-to-String for exotic floats) is
// out of scope; keep decision payloads to strings, integers, and booleans and
// this is exact. Confirm against the spec if you ever sign floats.

export function canonicalize(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite number");
    return JSON.stringify(value);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]));
    return "{" + parts.join(",") + "}";
  }
  throw new Error("Cannot canonicalize value of type " + t);
}
