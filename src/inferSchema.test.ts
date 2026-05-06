import { describe, it, expect } from 'vitest';
import { inferSchema, fingerprint } from './inferSchema';

describe('inferSchema', () => {
  it('should infer schema for a Stripe-style charge object', () => {
    const payload = {
      id: "ch_123",
      object: "charge",
      amount: 2000,
      currency: "usd",
      customer: {
        id: "cus_456",
        email: "test@example.com",
        created: 123456789
      },
      metadata: {
        order_id: "678"
      },
      paid: true,
      refunded: false
    };

    const schema = inferSchema(payload);
    
    expect(schema.type).toBe('object');
    expect(schema.properties.customer.type).toBe('object');
    expect(schema.properties.customer.properties.email.type).toBe('string');
    expect(schema.required).toContain('id');
    expect(schema.required).toContain('customer');
    
    const fp = fingerprint(schema);
    expect(typeof fp).toBe('string');
    // Ensure deterministic (sorting)
    expect(fp).toBe(fingerprint(inferSchema(payload)));
  });

  it('should infer schema for a flat GitHub webhook ping payload', () => {
    const payload = {
      zen: "Non-blocking is better than blocking.",
      hook_id: 123456,
      hook: {
        type: "Repository",
        id: 789,
        name: "webhook",
        active: true,
        events: ["push", "pull_request"]
      },
      repository: {
        id: 456,
        name: "test-repo",
        owner: {
          login: "octocat",
          id: 1
        }
      },
      sender: {
        login: "octocat",
        id: 1
      }
    };

    const schema = inferSchema(payload);
    expect(schema.type).toBe('object');
    expect(schema.properties.zen.type).toBe('string');
    expect(schema.properties.hook_id.type).toBe('number');
    expect(schema.properties.hook.properties.active.type).toBe('boolean');
    expect(schema.properties.hook.properties.events.type).toBe('array');
    expect(schema.properties.hook.properties.events.items.type).toBe('string');
  });

  it('should infer schema for an array of line items with mixed nullable fields', () => {
    const payload = [
      { id: 1, description: "item 1", price: 10.5, discount: null },
      { id: 2, description: "item 2", price: 20.0, discount: 5.0 }
    ];

    const schema = inferSchema(payload);
    expect(schema.type).toBe('array');
    expect(schema.items.type).toBe('object');
    expect(schema.items.properties.discount.type).toBe('null');
    
    // Test with the other one first
    const payload2 = [
      { id: 2, description: "item 2", price: 20.0, discount: 5.0 },
      { id: 1, description: "item 1", price: 10.5, discount: null }
    ];
    const schema2 = inferSchema(payload2);
    expect(schema2.items.properties.discount.type).toBe('number');
  });

  it('should be deterministic with fingerprint', () => {
    const schema1 = {
      type: "object",
      properties: {
        b: { type: "string" },
        a: { type: "number" }
      },
      required: ["a", "b"]
    };
    
    const schema2 = {
      required: ["a", "b"],
      properties: {
        a: { type: "number" },
        b: { type: "string" }
      },
      type: "object"
    };
    
    expect(fingerprint(schema1)).toBe(fingerprint(schema2));
  });
});
