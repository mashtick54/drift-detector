export type ChangeType = "field_added" | "field_removed" | "type_changed" | "nullability_changed";
export type Severity = "info" | "warning" | "breaking";

export interface SchemaDiff {
  path: string;
  changeType: ChangeType;
  severity: Severity;
}

/**
 * Compares two inferred schemas and returns a list of differences.
 */
export function diffSchemas(before: any, after: any, path: string = ""): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];

  // Handle case where types differ at the current level
  if (before.type !== after.type) {
    if (after.type === "null") {
      diffs.push({
        path: path || "(root)",
        changeType: "nullability_changed",
        severity: "warning",
      });
    } else {
      diffs.push({
        path: path || "(root)",
        changeType: "type_changed",
        severity: "breaking",
      });
    }
    // If types changed, we don't necessarily want to recurse further into mismatched structures
    return diffs;
  }

  // If both are objects, compare properties
  if (before.type === "object" && after.type === "object") {
    const beforeProps = before.properties || {};
    const afterProps = after.properties || {};

    const beforeKeys = Object.keys(beforeProps);
    const afterKeys = Object.keys(afterProps);

    // Removed fields
    for (const key of beforeKeys) {
      if (!(key in afterProps)) {
        diffs.push({
          path: path ? `${path}.${key}` : key,
          changeType: "field_removed",
          severity: "breaking",
        });
      }
    }

    // Added fields
    for (const key of afterKeys) {
      if (!(key in beforeProps)) {
        diffs.push({
          path: path ? `${path}.${key}` : key,
          changeType: "field_added",
          severity: "info",
        });
      }
    }

    // Common fields
    for (const key of beforeKeys) {
      if (key in afterProps) {
        const nestedDiffs = diffSchemas(
          beforeProps[key],
          afterProps[key],
          path ? `${path}.${key}` : key
        );
        diffs.push(...nestedDiffs);
      }
    }
  }

  // If both are arrays, compare items
  if (before.type === "array" && after.type === "array") {
    if (before.items && after.items) {
      const nestedDiffs = diffSchemas(before.items, after.items, `${path}[]`);
      diffs.push(...nestedDiffs);
    }
  }

  return diffs;
}
