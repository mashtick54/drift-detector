/**
 * Recursively infers a JSON Schema from any JavaScript value.
 */
export function inferSchema(payload: unknown): any {
  if (payload === null) {
    return { type: "null" };
  }

  if (Array.isArray(payload)) {
    return {
      type: "array",
      items: payload.length > 0 ? inferSchema(payload[0]) : {},
    };
  }

  if (typeof payload === "object") {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      properties[key] = inferSchema(value);
      required.push(key);
    }

    return {
      type: "object",
      properties,
      required: required.sort(),
    };
  }

  if (typeof payload === "string") {
    return { type: "string" };
  }

  if (typeof payload === "number") {
    return { type: "number" };
  }

  if (typeof payload === "boolean") {
    return { type: "boolean" };
  }

  return {};
}

/**
 * Returns a deterministic sorted JSON string of the schema, suitable for comparison.
 */
export function fingerprint(schema: object): string {
  return JSON.stringify(sortObject(schema));
}

function sortObject(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  }

  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, any> = {};

  for (const key of sortedKeys) {
    result[key] = sortObject(obj[key]);
  }

  return result;
}
