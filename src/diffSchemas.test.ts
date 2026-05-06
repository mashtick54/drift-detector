import { describe, it, expect } from 'vitest';
import { inferSchema } from './inferSchema';
import { diffSchemas } from './diffSchemas';

describe('diffSchemas', () => {
  it('should detect field_added as info', () => {
    const before = inferSchema({ a: 1 });
    const after = inferSchema({ a: 1, b: 2 });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'b',
      changeType: 'field_added',
      severity: 'info'
    });
  });

  it('should detect field_removed as breaking', () => {
    const before = inferSchema({ a: 1, b: 2 });
    const after = inferSchema({ a: 1 });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'b',
      changeType: 'field_removed',
      severity: 'breaking'
    });
  });

  it('should detect type_changed as breaking', () => {
    const before = inferSchema({ a: 1 });
    const after = inferSchema({ a: "one" });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'a',
      changeType: 'type_changed',
      severity: 'breaking'
    });
  });

  it('should detect nullability_changed as warning when became nullable', () => {
    const before = inferSchema({ a: "text" });
    const after = inferSchema({ a: null });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'a',
      changeType: 'nullability_changed',
      severity: 'warning'
    });
  });

  it('should handle nested paths correctly', () => {
    const before = inferSchema({ 
      user: { 
        address: { zip: "12345" } 
      } 
    });
    const after = inferSchema({ 
      user: { 
        address: { zip: 12345 } 
      } 
    });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'user.address.zip',
      changeType: 'type_changed',
      severity: 'breaking'
    });
  });

  it('should handle array item changes', () => {
    const before = inferSchema({ items: [{ id: 1 }] });
    const after = inferSchema({ items: [{ id: "1" }] });
    const diffs = diffSchemas(before, after);

    expect(diffs).toContainEqual({
      path: 'items[].id',
      changeType: 'type_changed',
      severity: 'breaking'
    });
  });
});
