// canonical.mjs — RFC-8785 (JCS) canonical JSON.
// The signer and the verifier MUST produce byte-identical bytes for the same
// logical payload, or every signature silently fails to verify. JCS gives us
// that: object keys sorted by UTF-16 code unit, no insignificant whitespace,
// numbers and strings serialized deterministically.
//
// Node's JSON.stringify already serializes strings per the JSON spec and
// integers (and the modest decimals this course uses) in the JCS-compatible
// shortest form, so the only thing we must add is recursive key sorting.
// We reject values JCS cannot canonicalize (NaN, Infinity, bigint, undefined,
// functions) loudly rather than emit bytes the verifier would not reproduce.

function canonicalize(value) {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";

  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonical: non-finite number cannot be canonicalized: ${value}`);
    }
    // JSON.stringify emits the ECMAScript Number-to-String shortest round-trip
    // form, which matches JCS for the integer/2-decimal values used here.
    return JSON.stringify(value);
  }

  if (t === "string") return JSON.stringify(value);

  if (t === "bigint") {
    throw new Error("canonical: bigint is not representable in JSON");
  }

  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(coerceUndefined(v))).join(",") + "]";
  }

  if (t === "object") {
    const keys = Object.keys(value).sort(compareCodeUnits);
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue; // JSON drops undefined object members
      parts.push(JSON.stringify(k) + ":" + canonicalize(v));
    }
    return "{" + parts.join(",") + "}";
  }

  throw new Error(`canonical: unsupported value of type ${t}`);
}

function coerceUndefined(v) {
  // JSON serializes array holes / undefined entries as null.
  return v === undefined ? null : v;
}

// Sort by UTF-16 code units, which is what JCS specifies (and what the default
// Array.prototype.sort comparator does for strings, but we are explicit).
function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function canonicalJSON(value) {
  return canonicalize(value);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJSON(value), "utf8");
}

// CLI self-test: `node canonical.mjs` proves key order and nesting are stable.
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = { b: 1, a: 2, nested: { z: 1, y: [3, 2, 1] } };
  const b = { nested: { y: [3, 2, 1], z: 1 }, a: 2, b: 1 };
  const ca = canonicalJSON(a);
  const cb = canonicalJSON(b);
  console.log(ca);
  if (ca !== cb) {
    console.error("FAIL: same logical payload produced different canonical bytes");
    process.exit(1);
  }
  console.log("canonical self-test OK (key order and nesting are stable)");
}
