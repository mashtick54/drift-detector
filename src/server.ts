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
  getDiffs,
  getTotalDiffsCount,
  getGlobalLastChecked
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

app.get('/', (c) => {
  const endpoints = getEndpoints();
  const allRecentDiffs = getAllDiffsWithEndpoint();
  const totalDiffsCount = getTotalDiffsCount();
  const globalLastChecked = getGlobalLastChecked();

  const endpointsCount = endpoints.length;
  const lastCheckedStr = globalLastChecked ? new Date(globalLastChecked).toLocaleString() : 'Never';

  const endpointCards = endpoints.map(e => {
    const lastSnapshot = getLastSnapshot(e.id);
    const lastDiff = getDiffs(e.id)[0];
    const isStable = !lastDiff;
    const statusText = isStable ? 'Stable' : 'Drift Detected';
    const statusColor = isStable ? '#10b981' : '#ef4444';
    const lastChecked = lastSnapshot ? new Date(lastSnapshot.sampled_at).toLocaleString() : 'Never';

    return `
      <div class="card endpoint-card">
        <div class="endpoint-header">
          <span class="endpoint-name">${e.name}</span>
          <span class="status-pill" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">${statusText}</span>
        </div>
        <div class="endpoint-url" title="${e.url}">${e.url}</div>
        <div class="endpoint-meta">Last checked: ${lastChecked}</div>
      </div>
    `;
  }).join('');

  const diffRows = allRecentDiffs.flatMap(d => {
    const diffList = JSON.parse(d.diffs_json);
    return diffList.map((item: any) => {
      let severityColor = '#10b981';
      if (item.severity === 'breaking') severityColor = '#ef4444';
      else if (item.severity === 'warning') severityColor = '#f59e0b';

      return `
        <tr>
          <td>${d.endpoint_name}</td>
          <td class="mono">${item.path}</td>
          <td>${item.changeType}</td>
          <td><span class="badge" style="background: ${severityColor}20; color: ${severityColor}; border: 1px solid ${severityColor}40;">${item.severity}</span></td>
          <td style="color: #94a3b8;">${new Date(d.detected_at).toLocaleString()}</td>
        </tr>
      `;
    });
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Drift Detector</title>
      <meta http-equiv="refresh" content="30">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #0f1117;
          --card: #1a1d27;
          --border: #2a2d3e;
          --accent: #6366f1;
          --text-main: #ffffff;
          --text-muted: #94a3b8;
          --success: #10b981;
        }
        * { box-sizing: border-box; }
        body {
          background-color: var(--bg);
          color: var(--text-main);
          font-family: 'Inter', sans-serif;
          margin: 0;
          padding: 0;
          line-height: 1.5;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
        
        /* Navbar */
        nav {
          border-bottom: 1px solid var(--border);
          padding: 16px 0;
          margin-bottom: 32px;
        }
        .nav-content { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.25rem; font-weight: 700; color: #fff; text-decoration: none; }
        .live-status {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #10b98120;
          color: #10b981;
          padding: 4px 12px;
          border-radius: 9999px;
          font-size: 0.875rem;
          font-weight: 600;
          border: 1px solid #10b98140;
        }
        .live-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; }

        /* Stats Bar */
        .stats-bar {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 40px;
        }
        .stat-card {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 24px;
          border-radius: 12px;
        }
        .stat-label { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 8px; }
        .stat-value { font-size: 1.75rem; font-weight: 700; }

        /* Endpoints */
        h2 { font-size: 1.5rem; font-weight: 600; margin-bottom: 20px; }
        .endpoints-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
          margin-bottom: 48px;
        }
        .endpoint-card {
          background: var(--card);
          border: 1px solid var(--border);
          padding: 24px;
          border-radius: 12px;
          transition: border-color 0.2s;
        }
        .endpoint-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }
        .endpoint-name { font-size: 1.25rem; font-weight: 600; }
        .status-pill { padding: 2px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
        .endpoint-url {
          color: var(--text-muted);
          font-size: 0.875rem;
          margin-bottom: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .endpoint-meta { color: var(--text-muted); font-size: 0.75rem; }

        /* Recent Diffs Table */
        .table-container {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 48px;
        }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { background: #1f2230; padding: 12px 16px; font-size: 0.875rem; font-weight: 600; color: var(--text-muted); }
        td { padding: 16px; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
        tr:last-child td { border-bottom: none; }
        tr:nth-child(even) { background: #1c1f2b; }
        .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; color: var(--accent); }
        .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: capitalize; }

        /* Footer */
        footer {
          border-top: 1px solid var(--border);
          padding: 32px 0;
          color: var(--text-muted);
          font-size: 0.875rem;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <nav>
        <div class="container nav-content">
          <a href="/" class="logo">Drift Detector</a>
          <div class="live-status">
            <span class="live-dot"></span>
            Live
          </div>
        </div>
      </nav>

      <main class="container">
        <div class="stats-bar">
          <div class="stat-card">
            <div class="stat-label">Endpoints Monitored</div>
            <div class="stat-value">${endpointsCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Diffs Detected</div>
            <div class="stat-value">${totalDiffsCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Last Checked</div>
            <div class="stat-value" style="font-size: 1.1rem; padding-top: 8px;">${lastCheckedStr}</div>
          </div>
        </div>

        <h2>Endpoints</h2>
        <div class="endpoints-grid">
          ${endpointCards || '<div style="grid-column: 1/-1; color: var(--text-muted);">No endpoints configured</div>'}
        </div>

        <h2>Recent Diffs</h2>
        <div class="table-container">
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
              ${diffRows || '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">No diffs detected yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </main>

      <footer>
        <div class="container">
          Built with Drift Detector &bull; ${new Date().getFullYear()}
        </div>
      </footer>
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
