const fetch = require('undici').fetch;

async function test() {
  const response = await fetch('http://localhost:3000/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerEmail: 'test@example.com', name: 'Test Org' })
  });
  const data = await response.json();
  console.log('API Key created:', JSON.stringify(data, null, 2));

  const endpointsResponse = await fetch('http://localhost:3000/endpoints', {
    headers: { 'X-API-Key': data.key }
  });
  const endpoints = await endpointsResponse.json();
  console.log('Endpoints (scoped):', endpoints);

  const unauthorizedResponse = await fetch('http://localhost:3000/endpoints');
  console.log('Unauthorized status:', unauthorizedResponse.status);
}

test().catch(console.error);
