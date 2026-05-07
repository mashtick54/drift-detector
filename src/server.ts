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
  getGlobalLastChecked,
  createApiKey,
  deleteEndpoint,
  getApiKeysByUser
} from './db';
import { inferSchema, fingerprint } from './inferSchema';
import { diffSchemas } from './diffSchemas';
import { sendBreakingChangeAlert } from './alerts';
import { 
  signupHandler, 
  loginHandler, 
  logoutHandler, 
  verifyHandler, 
  forgotPasswordHandler, 
  resetPasswordHandler,
  updateNameHandler,
  updatePasswordHandler,
  generateKeyHandler,
  revokeKeyHandler
} from './auth';
import { requireAuth, AuthContext } from './middleware';
import { dashboardLayout } from './layouts';
import { billingPageHandler, upgradeHandler, verifyBillingHandler, webhookHandler } from './billing';

const app = new Hono<AuthContext>();

// Utility function to process an endpoint check
async function checkEndpoint(userId: number | bigint, apiKeyId: number | bigint | null, endpoint: any, data: unknown) {
  const schema = inferSchema(data);
  const fp = fingerprint(schema);
  const schemaJson = JSON.stringify(schema);

  const lastSnapshot = getLastSnapshot(userId, endpoint.id);
  const snapshotId = insertSnapshot(userId, endpoint.id, schemaJson, fp);

  if (lastSnapshot && lastSnapshot.fingerprint !== fp) {
    const lastSchema = JSON.parse(lastSnapshot.schema_json);
    const diffs = diffSchemas(lastSchema, schema);
    
    if (diffs.length > 0) {
      insertDiff(userId, endpoint.id, lastSnapshot.id, snapshotId, JSON.stringify(diffs));
      
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

// Auth UI Routes
const layout = (title: string, content: string) => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${title} - Drift Detector</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --primary: #3C50E0;
        --primary-dark: #3143C0;
        --bg: #F1F5F9;
        --sidebar: #1C2434;
        --sidebar-hover: #333A48;
        --text-dark: #1C2434;
        --text-muted: #64748B;
        --border: #E2E8F0;
        --white: #FFFFFF;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; background-color: var(--bg); color: var(--text-dark); }
      .btn { padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: 0.2s; }
      .btn-primary { background: var(--primary); color: white; }
      .btn-primary:hover { background: var(--primary-dark); }
      .card { background: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
      input { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; margin-top: 8px; margin-bottom: 16px; font-family: inherit; }
      label { font-size: 14px; font-weight: 500; color: var(--text-dark); }
    </style>
  </head>
  <body>${content}</body>
  </html>
`;

app.get('/signup', (c) => c.html(layout('Sign Up', `
  <div style="display: flex; min-height: 100vh;">
    <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: white;">
      <div style="max-width: 400px; width: 100%; padding: 40px;">
        <h1 style="font-size: 32px; margin-bottom: 8px;">Sign Up</h1>
        <p style="color: var(--text-muted); margin-bottom: 32px;">Secure Your Communications with Drift Detector</p>
        <form action="/auth/signup" method="POST">
          <label>Name</label>
          <input type="text" name="name" placeholder="John Doe" required>
          <label>Email Address</label>
          <input type="email" name="email" placeholder="john@example.com" required>
          <label>Password</label>
          <input type="password" name="password" placeholder="At least 8 characters" required minlength="8">
          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 16px;">Sign Up</button>
        </form>
        <p style="margin-top: 24px; text-align: center; font-size: 14px;">Already member? <a href="/login" style="color: var(--primary); text-decoration: none;">Sign in</a></p>
      </div>
    </div>
    <div style="flex: 1.2; background: linear-gradient(135deg, #5E5CE6 0%, #3C50E0 100%); display: flex; align-items: center; justify-content: center; padding: 40px;">
      <div style="text-align: center; color: white;">
        <div style="background: rgba(255,255,255,0.1); border-radius: 20px; padding: 40px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 48px; font-weight: 700; margin-bottom: 16px;">Drift Detector</div>
          <p style="font-size: 18px; opacity: 0.8;">The modern way to monitor API schema drift.</p>
        </div>
      </div>
    </div>
  </div>
`)));

app.get('/login', (c) => c.html(layout('Login', `
  <div style="display: flex; min-height: 100vh;">
    <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: white;">
      <div style="max-width: 400px; width: 100%; padding: 40px;">
        <h1 style="font-size: 32px; margin-bottom: 8px;">Sign In</h1>
        <p style="color: var(--text-muted); margin-bottom: 32px;">Enter your credentials to access your account</p>
        <form action="/auth/login" method="POST">
          <label>Email Address</label>
          <input type="email" name="email" placeholder="john@example.com" required>
          <label>Password</label>
          <input type="password" name="password" placeholder="********" required>
          <div style="text-align: right; margin-bottom: 16px;">
            <a href="/forgot-password" style="font-size: 14px; color: var(--primary); text-decoration: none;">Forgot password?</a>
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%;">Sign In</button>
        </form>
        <p style="margin-top: 24px; text-align: center; font-size: 14px;">Not a member? <a href="/signup" style="color: var(--primary); text-decoration: none;">Sign up</a></p>
      </div>
    </div>
    <div style="flex: 1.2; background: linear-gradient(135deg, #1C2434 0%, #333A48 100%); display: flex; align-items: center; justify-content: center; padding: 40px;">
       <div style="text-align: center; color: white;">
        <div style="background: rgba(255,255,255,0.05); border-radius: 20px; padding: 40px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 48px; font-weight: 700; margin-bottom: 16px;">Welcome Back</div>
          <p style="font-size: 18px; opacity: 0.8;">Check your API health in real-time.</p>
        </div>
      </div>
    </div>
  </div>
`)));

app.get('/forgot-password', (c) => c.html(layout('Forgot Password', `
  <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center;">
    <div class="card" style="max-width: 400px; width: 100%;">
      <h1 style="margin-bottom: 16px;">Forgot Password</h1>
      <p style="color: var(--text-muted); margin-bottom: 24px;">Enter your email and we'll send you a reset link.</p>
      <form action="/auth/forgot-password" method="POST">
        <label>Email Address</label>
        <input type="email" name="email" placeholder="john@example.com" required>
        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 16px;">Send Reset Link</button>
      </form>
    </div>
  </div>
`)));

app.get('/reset-password', (c) => {
  const token = c.req.query('token');
  return c.html(layout('Reset Password', `
    <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center;">
      <div class="card" style="max-width: 400px; width: 100%;">
        <h1 style="margin-bottom: 16px;">Reset Password</h1>
        <form action="/auth/reset-password" method="POST">
          <input type="hidden" name="token" value="${token}">
          <label>New Password</label>
          <input type="password" name="password" placeholder="At least 8 characters" required minlength="8">
          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 16px;">Reset Password</button>
        </form>
      </div>
    </div>
  `));
});

// Auth API Routes
app.post('/auth/signup', signupHandler);
app.post('/auth/login', loginHandler);
app.post('/auth/logout', logoutHandler);
app.get('/auth/verify', verifyHandler);
app.post('/auth/forgot-password', forgotPasswordHandler);
app.post('/auth/reset-password', resetPasswordHandler);

// Dashboard
app.get('/', requireAuth, (c) => {
  const user = c.get('user');
  const endpoints = getEndpoints(user.id);
  const allRecentDiffs = getAllDiffsWithEndpoint(user.id);
  const totalDiffsCount = getTotalDiffsCount(user.id);
  const globalLastChecked = getGlobalLastChecked(user.id);

  const endpointsCount = endpoints.length;
  const lastCheckedStr = globalLastChecked ? new Date(globalLastChecked).toLocaleString() : 'Never';

  const endpointCards = endpoints.map(e => {
    const lastSnapshot = getLastSnapshot(user.id, e.id);
    const lastDiff = getDiffs(user.id, e.id)[0];
    const isStable = !lastDiff;
    const statusText = isStable ? 'Stable' : 'Drift Detected';
    const statusColor = isStable ? '#10b981' : '#ef4444';
    const lastChecked = lastSnapshot ? new Date(lastSnapshot.sampled_at).toLocaleString() : 'Never';

    return `
      <div class="card" style="padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 600;">${e.name}</span>
          <span class="status-pill" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">${statusText}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${e.url}">${e.url}</div>
        <div style="font-size: 12px; color: var(--text-muted);">Last checked: ${lastChecked}</div>
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

  return c.html(dashboardLayout(c, user, `
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 40px;">
            <div class="card" style="margin-bottom: 0;">
              <div style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">${endpointsCount}</div>
              <div style="font-size: 14px; color: var(--text-muted);">Endpoints Monitored</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
              <div style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">${totalDiffsCount}</div>
              <div style="font-size: 14px; color: var(--text-muted);">Total Diffs</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
              <div style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">100%</div>
              <div style="font-size: 14px; color: var(--text-muted);">Uptime</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
              <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px; padding-top: 8px;">${lastCheckedStr}</div>
              <div style="font-size: 14px; color: var(--text-muted);">Last Checked</div>
            </div>
          </div>

          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 24px;">Active Endpoints</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; margin-bottom: 40px;">
            ${endpointCards || '<div class="card" style="grid-column: 1/-1;">No endpoints yet. <a href="/endpoints">Add one now.</a></div>'}
          </div>

          <div class="card">
            <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 24px;">Recent Schema Diffs</h2>
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Path</th>
                  <th>Change</th>
                  <th>Severity</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${diffRows || '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">No diffs detected. Your APIs are stable!</td></tr>'}
              </tbody>
            </table>
          </div>
  `));
});

// API Routes
app.get('/api/endpoints', requireAuth, (c) => {
  const user = c.get('user');
  const endpoints = getEndpoints(user.id);
  return c.json(endpoints);
});

app.post('/api/endpoints', requireAuth, async (c) => {
  const user = c.get('user');
  const endpoints = getEndpoints(user.id);
  if (user.plan === 'free' && endpoints.length >= 3) {
    return c.json({ error: 'Upgrade to Pro to add more endpoints', billing_url: '/billing' }, 403);
  }
  const { name, url, method, headers } = await c.req.json();
  const id = insertEndpoint(user.id, null, name, url, method, headers || {});
  return c.json({ id, name, url, method, headers });
});

app.post('/api/proxy', requireAuth, async (c) => {
  const user = c.get('user');
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
  
  const endpoints = getEndpoints(user.id);
  const endpoint = endpoints.find(e => e.url === target);
  
  if (endpoint) {
    await checkEndpoint(user.id, null, endpoint, responseData);
  }

  return c.json(responseData);
});

// GET /endpoints
app.get('/endpoints', requireAuth, (c) => {
  const user = c.get('user');
  const endpoints = getEndpoints(user.id);
  
  const endpointRows = endpoints.map(e => {
    const lastSnapshot = getLastSnapshot(user.id, e.id);
    const lastDiff = getDiffs(user.id, e.id)[0];
    const isStable = !lastDiff;
    const statusText = isStable ? 'Stable' : 'Drift Detected';
    const statusColor = isStable ? '#10b981' : '#ef4444';
    const lastChecked = lastSnapshot ? new Date(lastSnapshot.sampled_at).toLocaleString() : 'Never';

    return `
      <tr>
        <td>
          <div style="font-weight: 600;">${e.name}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${e.url}</div>
        </td>
        <td>${e.method}</td>
        <td><span class="status-pill" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">${statusText}</span></td>
        <td>${lastChecked}</td>
        <td>
          <form action="/endpoints/${e.id}/delete" method="POST" onsubmit="return confirm('Delete this endpoint?')">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <button type="submit" style="color: #ef4444; background: none; border: none; cursor: pointer; font-size: 14px;">Delete</button>
          </form>
        </td>
      </tr>
    `;
  }).join('');

  return c.html(`
    ${dashboardLayout(c, user, `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h1>Endpoints</h1>
        ${user.plan === 'free' && endpoints.length >= 3 ? 
          '<div style="background: #fffbeb; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; color: #b45309; font-size: 14px;">You\'ve reached the free plan limit. <a href="/billing" style="font-weight: 600; color: #b45309;">Upgrade</a> to monitor more.</div>' : 
          '<button onclick="document.getElementById(\'add-modal\').style.display=\'flex\'" class="btn btn-primary">+ Add Endpoint</button>'
        }
      </div>

      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Name & URL</th>
              <th>Method</th>
              <th>Status</th>
              <th>Last Checked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${endpointRows || '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">No endpoints yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div id="add-modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 100;">
        <div class="card" style="max-width: 500px; width: 100%;">
          <h2>Add New Endpoint</h2>
          <form action="/endpoints/add" method="POST">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <label>Name</label>
            <input type="text" name="name" placeholder="Stripe Payments" required>
            <label>URL</label>
            <input type="url" name="url" placeholder="https://api.stripe.com/v1/charges" required>
            <label>Method</label>
            <select name="method" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; margin-top: 8px; margin-bottom: 16px;">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <label>Headers (JSON String)</label>
            <input type="text" name="headers" placeholder='{"Authorization": "Bearer ..."}' value="{}">
            <div style="display: flex; gap: 12px; margin-top: 16px;">
              <button type="submit" class="btn btn-primary" style="flex: 1;">Save Endpoint</button>
              <button type="button" onclick="document.getElementById('add-modal').style.display='none'" class="btn" style="background: #E2E8F0;">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `)}
  `);
});

app.post('/endpoints/add', requireAuth, async (c) => {
  const user = c.get('user');
  const endpoints = getEndpoints(user.id);
  if (user.plan === 'free' && endpoints.length >= 3) {
    return c.text('Upgrade to Pro to add more endpoints', 403);
  }
  const { name, url, method, headers } = await c.req.parseBody() as any;
  insertEndpoint(user.id, null, name, url, method, JSON.parse(headers || '{}'));
  return c.redirect('/endpoints');
});

app.post('/endpoints/:id/delete', requireAuth, async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  deleteEndpoint(user.id, Number(id));
  return c.redirect('/endpoints');
});

// GET /alerts
app.get('/alerts', requireAuth, (c) => {
  const user = c.get('user');
  const allRecentDiffs = getAllDiffsWithEndpoint(user.id);

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

  return c.html(`
    ${dashboardLayout(c, user, `
      <h1 style="margin-bottom: 24px;">Security Alerts</h1>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Path</th>
              <th>Change</th>
              <th>Severity</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${diffRows || '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">No alerts yet. Your APIs are stable!</td></tr>'}
          </tbody>
        </table>
      </div>
    `)}
  `);
});

// GET /profile
app.get('/profile', requireAuth, (c) => {
  const user = c.get('user');
  const apiKeys = getApiKeysByUser(user.id);
  const newKey = c.req.query('new_key');

  const keyRows = apiKeys.map(k => {
    const preview = `${k.key.substring(0, 7)}...${k.key.substring(k.key.length - 4)}`;
    return `
      <tr>
        <td>${k.name}</td>
        <td class="mono">${preview}</td>
        <td>${new Date(k.created_at).toLocaleDateString()}</td>
        <td>
          <form action="/profile/keys/${k.id}/revoke" method="POST">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <button type="submit" style="color: #ef4444; background: none; border: none; cursor: pointer;">Revoke</button>
          </form>
        </td>
      </tr>
    `;
  }).join('');

  return c.html(`
    ${dashboardLayout(c, user, `
      <h1 style="margin-bottom: 24px;">Account Settings</h1>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div class="card">
          <h2>Profile Information</h2>
          <form action="/profile/name" method="POST">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <label>Full Name</label>
            <input type="text" name="name" value="${user.name}" required>
            <label>Email Address</label>
            <input type="email" value="${user.email}" disabled style="background: #f8fafc;">
            <div style="margin-bottom: 16px;">
              <span class="badge" style="background: #3C50E020; color: #3C50E0;">${user.plan.toUpperCase()} PLAN</span>
            </div>
            <button type="submit" class="btn btn-primary">Update Profile</button>
          </form>
        </div>

        <div class="card">
          <h2>Security</h2>
          <form action="/profile/password" method="POST">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <label>Current Password</label>
            <input type="password" name="currentPassword" required>
            <label>New Password</label>
            <input type="password" name="newPassword" required minlength="8">
            <label>Confirm New Password</label>
            <input type="password" name="confirmPassword" required minlength="8">
            <button type="submit" class="btn btn-primary">Change Password</button>
          </form>
        </div>
      </div>

      <div class="card" style="margin-top: 24px;">
        <h2>API Keys</h2>
        ${newKey ? `
          <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <div style="color: #166534; font-weight: 600; margin-bottom: 8px;">New API Key Generated!</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <code style="background: white; padding: 8px; border-radius: 4px; flex: 1; border: 1px solid #16a34a40;">${newKey}</code>
              <button onclick="navigator.clipboard.writeText('${newKey}'); alert('Copied!')" class="btn" style="background: #16a34a; color: white;">Copy</button>
            </div>
            <div style="color: #ef4444; font-size: 12px; margin-top: 8px;">Save this key - it won't be shown again.</div>
          </div>
        ` : ''}
        
        <form action="/profile/keys" method="POST" style="margin-bottom: 24px; display: flex; gap: 12px; align-items: flex-end;">
          <input type="hidden" name="csrf_token" value="${user.csrf_token}">
          <div style="flex: 1;">
            <label>Key Name</label>
            <input type="text" name="name" placeholder="Development" required style="margin-bottom: 0;">
          </div>
          <button type="submit" class="btn btn-primary">Generate New Key</button>
        </form>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${keyRows || '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px;">No API keys yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `)}
  `);
});

app.post('/profile/name', requireAuth, updateNameHandler);
app.post('/profile/password', requireAuth, updatePasswordHandler);
app.post('/profile/keys', requireAuth, generateKeyHandler);
app.post('/profile/keys/:id/revoke', requireAuth, revokeKeyHandler);

// Billing Routes
app.get('/billing', requireAuth, (c) => {
  const user = c.get('user');
  return billingPageHandler(c).then(content => c.html(dashboardLayout(c, user, content as string)));
});

app.post('/billing/upgrade', requireAuth, upgradeHandler);
app.get('/billing/verify', verifyBillingHandler);
app.post('/billing/webhook', webhookHandler);

// Cron job: Every 60 minutes
cron.schedule('0 * * * *', async () => {
  console.log('Running scheduled drift check...');
  const endpoints = getEndpoints(); // All endpoints across all tenants
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: JSON.parse(endpoint.headers_json),
      });
      const data = await response.json();
      await checkEndpoint(endpoint.user_id, endpoint.api_key_id, endpoint, data);
    } catch (error) {
      console.error(`Failed to check endpoint ${endpoint.name}:`, error);
    }
  }
});

export const startServer = () => {
  // Check required env vars
  const required = ['PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY', 'PAYSTACK_WEBHOOK_SECRET'];
  required.forEach(k => {
    if (!process.env[k]) console.warn(`WARNING: Missing \${k} environment variable. Billing features will be limited.`);
  });

  const port = 3000;
  console.log(`Server is running on port ${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
};
