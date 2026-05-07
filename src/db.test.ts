import { describe, it, expect, beforeAll } from 'vitest';
import { 
  insertEndpoint, 
  getEndpoints, 
  insertSnapshot, 
  getLastSnapshot, 
  insertDiff, 
  getDiffs,
  createApiKey,
  createUser,
  db
} from './db';

describe('Database Operations', () => {
  let userId: number | bigint;
  let apiKeyId: number | bigint;

  beforeAll(() => {
    const { user } = createUser('test@test.com', 'password123', 'Test User');
    userId = user.id;
    const apiKey = createApiKey(userId, 'test@test.com', 'Test Org');
    apiKeyId = apiKey.id;
  });

  it('should insert and retrieve an endpoint', () => {
    const id = insertEndpoint(userId, apiKeyId, 'Stripe Charge', 'https://api.stripe.com/v1/charges', 'POST', { Authorization: 'Bearer ...' });
    expect(id).toBeDefined();
    
    const endpoints = getEndpoints(userId);
    const stripe = endpoints.find(e => e.id === id);
    expect(stripe).toBeDefined();
    expect(stripe.name).toBe('Stripe Charge');
  });

  it('should insert and retrieve snapshots', () => {
    const endpointId = insertEndpoint(userId, apiKeyId, 'Test API', 'https://example.com', 'GET', {});
    const schemaJson = JSON.stringify({ type: 'object' });
    const fingerprint = 'abc';
    
    const snapshotId = insertSnapshot(userId, endpointId, schemaJson, fingerprint);
    expect(snapshotId).toBeDefined();
    
    const last = getLastSnapshot(userId, endpointId);
    expect(last).toBeDefined();
    expect(last.fingerprint).toBe(fingerprint);
  });

  it('should insert and retrieve diffs', () => {
    const endpointId = insertEndpoint(userId, apiKeyId, 'Diff API', 'https://example.com', 'GET', {});
    const s1 = insertSnapshot(userId, endpointId, '{}', 'f1');
    const s2 = insertSnapshot(userId, endpointId, '{}', 'f2');
    
    const diffId = insertDiff(userId, endpointId, s1, s2, JSON.stringify([{ path: 'a', changeType: 'field_added' }]));
    expect(diffId).toBeDefined();
    
    const diffs = getDiffs(userId, endpointId);
    expect(diffs.length).toBeGreaterThan(0);
    expect(JSON.parse(diffs[0].diffs_json)[0].path).toBe('a');
  });
});
