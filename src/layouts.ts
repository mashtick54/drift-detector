export const dashboardLayout = (c: any, user: any, content: string) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Drift Detector</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
      <style>
        :root {
          --primary: #3C50E0;
          --bg: #F1F5F9;
          --sidebar: #1C2434;
          --sidebar-hover: #333A48;
          --text-muted: #64748B;
          --border: #E2E8F0;
          --white: #FFFFFF;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background-color: var(--bg); display: flex; height: 100vh; overflow: hidden; }
        .btn { padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: 0.2s; }
        .btn-primary { background: var(--primary); color: white; }
        aside { width: 280px; background: var(--sidebar); color: white; padding: 32px 16px; flex-shrink: 0; display: flex; flex-direction: column; height: 100vh; }
        .logo { font-size: 24px; font-weight: 700; margin-bottom: 48px; display: block; color: white; text-decoration: none; }
        .nav-item { padding: 12px 16px; border-radius: 4px; color: #D1D5DB; text-decoration: none; display: flex; align-items: center; margin-bottom: 4px; transition: 0.2s; }
        .nav-item:hover, .nav-item.active { background: var(--sidebar-hover); color: white; }
        .nav-label { font-size: 14px; font-weight: 500; text-transform: uppercase; color: #8A99AF; margin: 24px 0 12px 16px; }
        main { flex: 1; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        header { background: var(--white); height: 80px; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .content { padding: 40px; flex: 1; overflow-y: auto; }
        .card { background: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; }
        td { padding: 16px; border-bottom: 1px solid var(--border); font-size: 14px; }
        .mono { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--primary); }
        .badge { padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 500; }
        .status-pill { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        input { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; margin-top: 8px; margin-bottom: 16px; font-family: inherit; }
        label { font-size: 14px; font-weight: 500; }
      </style>
    </head>
    <body>
      <aside>
        <a href="/" class="logo">Drift Detector</a>
        <div class="nav-label">Menu</div>
        <a href="/" class="nav-item ${c.req.path === '/' ? 'active' : ''}">Dashboard</a>
        <a href="/endpoints" class="nav-item ${c.req.path === '/endpoints' ? 'active' : ''}">Endpoints</a>
        <a href="/alerts" class="nav-item ${c.req.path === '/alerts' ? 'active' : ''}">Alerts</a>
        <a href="/billing" class="nav-item ${c.req.path === '/billing' ? 'active' : ''}">Billing</a>
        <div class="nav-label">Settings</div>
        <a href="/profile" class="nav-item ${c.req.path === '/profile' ? 'active' : ''}">Profile</a>
        <form action="/auth/logout" method="POST" style="margin-top: auto;">
          <input type="hidden" name="csrf_token" value="${user.csrf_token}">
          <button type="submit" class="nav-item" style="background: none; border: none; width: 100%; cursor: pointer; text-align: left;">Logout</button>
        </form>
      </aside>
      <main>
        <header>
          <div>Drift Detector</div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="text-align: right;">
              <div style="font-weight: 500;">${user.name}</div>
              <div style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${user.plan.toUpperCase()}</div>
            </div>
            <div style="width: 44px; height: 44px; background: #E2E8F0; border-radius: 50%;"></div>
          </div>
        </header>
        <div class="content">
          ${content}
        </div>
      </main>
    </body>
    </html>
`;
