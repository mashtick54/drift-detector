import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import cron from 'node-cron';
import { fetch } from 'undici';
import { 
  getEndpoints, 
  insertEndpoint, 
  insertSnapshot, 
  getLastSnapshot, 
  insertDiff,
  getAllDiffsWithEndpoint,
  getDiffs
} from './db';
import { inferSchema, fingerprint } from './inferSchema';
import { diffSchemas } from './diffSchemas';
import { sendBreakingChangeAlert } from './alerts';

const app = new Hono();

// Utility function to process an endpoint check
async function checkEndpoint(endpoint: any, data: unknown) {
  const schema = inferSchema(data);
  const fp = fingerprint(schema);
  const schemaJson = JSON.stringify(schema);

  const lastSnapshot = getLastSnapshot(endpoint.id);
  const snapshotId = insertSnapshot(endpoint.id, schemaJson, fp);

  if (lastSnapshot && lastSnapshot.fingerprint !== fp) {
    const lastSchema = JSON.parse(lastSnapshot.schema_json);
    const diffs = diffSchemas(lastSchema, schema);
    
    if (diffs.length > 0) {
      insertDiff(endpoint.id, lastSnapshot.id, snapshotId, JSON.stringify(diffs));
      
      const breaking = diffs.filter(d => d.severity === 'breaking');
      if (breaking.length > 0) {
        await sendBreakingChangeAlert(endpoint.name, diffs);
        for (const d of breaking) {
          console.warn(`ALERT: { endpoint: "${endpoint.name}", path: "${d.path}", changeType: "${d.changeType}", severity: "${d.severity}" }`);
        }
      }
    }
  }
}

// 0. GET / Dashboard
app.get('/', (c) => {
  const endpoints = getEndpoints();
  const allRecentDiffs = getAllDiffsWithEndpoint();

  const endpointRows = endpoints.map(e => {
    const lastSnapshot = getLastSnapshot(e.id);
    const lastDiff = getDiffs(e.id)[0];
    return `
      <tr>
        <td>${e.name}</td>
        <td>${e.url}</td>
        <td>${lastSnapshot?.sampled_at || 'Never'}</td>
        <td>${lastDiff?.detected_at || 'No changes'}</td>
      </tr>
    `;
  }).join('');

  const diffRows = allRecentDiffs.flatMap(d => {
    const diffList = JSON.parse(d.diffs_json);
    return diffList.map((item: any) => {
      let color = 'black';
      if (item.severity === 'breaking') color = 'red';
      else if (item.severity === 'warning') color = 'orange';
      else if (item.severity === 'info') color = 'green';

      return `
        <tr>
          <td>${d.endpoint_name}</td>
          <td>${item.path}</td>
          <td>${item.changeType}</td>
          <td style="color: ${color}; font-weight: bold;">${item.severity}</td>
          <td>${d.detected_at}</td>
        </tr>
      `;
    });
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Drift Detector</title>
      <meta http-equiv="refresh" content="30">
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f4f4f4; }
        tr:nth-child(even) { background-color: #f9f9f9; }
      </style>
    </head>
    <body>
      <h1>Drift Detector</h1>
      
      <h2>Endpoints</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Last Checked</th>
            <th>Last Change Detected</th>
          </tr>
        </thead>
        <tbody>
          ${endpointRows || '<tr><td colspan="4">No endpoints configured</td></tr>'}
        </tbody>
      </table>

      <h2>Recent Diffs</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Path</th>
            <th>Change Type</th>
            <th>Severity</th>
            <th>Detected At</th>
          </tr>
        </thead>
        <tbody>
          ${diffRows || '<tr><td colspan="5">No diffs detected</td></tr>'}
        </tbody>
      </table>
    </body>
    </html>
  `;
  return c.html(html);
});

// 1. GET /endpoints
app.get('/endpoints', (c) => {
  const endpoints = getEndpoints();
  return c.json(endpoints);
});

// 2. POST /endpoints
app.post('/endpoints', async (c) => {
  const { name, url, method, headers } = await c.req.json();
  const id = insertEndpoint(name, url, method, headers || {});
  return c.json({ id, name, url, method, headers });
});

// 3. POST /proxy?target=<url>
app.post('/proxy', async (c) => {
  const target = c.req.query('target');
  if (!target) return c.text('Missing target query param', 400);

  const method = c.req.method;
  const headers = c.req.header();
  const body = await c.req.text();

  const response = await fetch(target, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  });

  const responseData = await response.json();
  
  // Try to find if this endpoint exists in our DB to track it
  const endpoints = getEndpoints();
  const endpoint = endpoints.find(e => e.url === target);
  
  if (endpoint) {
    await checkEndpoint(endpoint, responseData);
  }

  return c.json(responseData);
});

// Cron job: Every 60 minutes
cron.schedule('0 * * * *', async () => {
  console.log('Running scheduled drift check...');
  const endpoints = getEndpoints();
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: JSON.parse(endpoint.headers_json),
      });
      const data = await response.json();
      await checkEndpoint(endpoint, data);
    } catch (error) {
      console.error(`Failed to check endpoint ${endpoint.name}:`, error);
    }
  }
});

export const startServer = () => {
  const port = 3000;
  console.log(`Server is running on port ${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
};
