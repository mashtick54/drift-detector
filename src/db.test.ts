import { describe, it, expect, beforeAll } from 'vitest';
import { 
  insertEndpoint, 
  getEndpoints, 
  insertSnapshot, 
  getLastSnapshot, 
  insertDiff, 
  getDiffs,
  createApiKey,
  db
} from './db';

describe('Database Operations', () => {
  let apiKeyId: number | bigint;

  beforeAll(() => {
    const apiKey = createApiKey('test@test.com', 'Test Org');
    apiKeyId = apiKey.id;
  });

  it('should insert and retrieve an endpoint', () => {
    const id = insertEndpoint(apiKeyId, 'Stripe Charge', 'https://api.stripe.com/v1/charges', 'POST', { Authorization: 'Bearer ...' });
    expect(id).toBeDefined();
    
    const endpoints = getEndpoints(apiKeyId);
    const stripe = endpoints.find(e => e.id === id);
    expect(stripe).toBeDefined();
    expect(stripe.name).toBe('Stripe Charge');
  });

  it('should insert and retrieve snapshots', () => {
    const endpointId = insertEndpoint(apiKeyId, 'Test API', 'https://example.com', 'GET', {});
    const schemaJson = JSON.stringify({ type: 'object' });
    const fingerprint = 'abc';
    
    const snapshotId = insertSnapshot(apiKeyId, endpointId, schemaJson, fingerprint);
    expect(snapshotId).toBeDefined();
    
    const last = getLastSnapshot(apiKeyId, endpointId);
    expect(last).toBeDefined();
    expect(last.fingerprint).toBe(fingerprint);
  });

  it('should insert and retrieve diffs', () => {
    const endpointId = insertEndpoint(apiKeyId, 'Diff API', 'https://example.com', 'GET', {});
    const s1 = insertSnapshot(apiKeyId, endpointId, '{}', 'f1');
    const s2 = insertSnapshot(apiKeyId, endpointId, '{}', 'f2');
    
    const diffId = insertDiff(apiKeyId, endpointId, s1, s2, JSON.stringify([{ path: 'a', changeType: 'field_added' }]));
    expect(diffId).toBeDefined();
    
    const diffs = getDiffs(apiKeyId, endpointId);
    expect(diffs.length).toBeGreaterThan(0);
    expect(JSON.parse(diffs[0].diffs_json)[0].path).toBe('a');
  });
});
