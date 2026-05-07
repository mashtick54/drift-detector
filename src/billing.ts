import { Context } from 'hono';
import crypto from 'crypto';
import { 
  getSubscriptionByUserId, 
  updateSubscription, 
  createSubscription as dbCreateSubscription,
  updateUserPlan,
  isEventProcessed,
  markEventProcessed,
  db
} from './db';
import { initializeTransaction, verifyTransaction } from './paystack';
import { sendBreakingChangeAlert } from './alerts';

const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || '';

export const billingPageHandler = async (c: Context) => {
  const user = c.get('user');
  const subscription = getSubscriptionByUserId(user.id) || { plan: 'free', status: 'active' };
  
  // For demo purposes, we'll fetch payment history from a mock or simple query if we had a payments table
  // For now let's show a simple table
  const history: any[] = []; 

  const isPro = subscription.plan === 'pro';
  
  const content = `
    <h1 style="margin-bottom: 24px;">Billing & Plans</h1>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 40px;">
      <div class="card ${!isPro ? 'active-plan' : ''}" style="border: ${!isPro ? '2px solid var(--primary)' : '1px solid var(--border)'}">
        <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
          <h2 style="margin-bottom: 0;">Free Plan</h2>
          ${!isPro ? '<span class="badge" style="background: var(--primary)20; color: var(--primary);">CURRENT</span>' : ''}
        </div>
        <div style="font-size: 32px; font-weight: 700; margin-bottom: 24px;">KES 0 <span style="font-size: 14px; font-weight: 400; color: var(--text-muted);">/ month</span></div>
        <ul style="list-style: none; padding: 0; margin-bottom: 32px;">
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ 3 Endpoints Max</li>
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ 7 Day History</li>
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ Email Alerts</li>
        </ul>
        ${isPro ? '<button disabled class="btn" style="width: 100%; background: #E2E8F0; cursor: not-allowed;">Downgrade</button>' : '<button disabled class="btn" style="width: 100%; background: #E2E8F0;">Active</button>'}
      </div>

      <div class="card ${isPro ? 'active-plan' : ''}" style="border: ${isPro ? '2px solid var(--primary)' : '1px solid var(--border)'}">
        <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
          <h2 style="margin-bottom: 0;">Pro Plan</h2>
          ${isPro ? '<span class="badge" style="background: var(--primary)20; color: var(--primary);">CURRENT</span>' : ''}
        </div>
        <div style="font-size: 32px; font-weight: 700; margin-bottom: 24px;">KES 900 <span style="font-size: 14px; font-weight: 400; color: var(--text-muted);">/ month</span></div>
        <ul style="list-style: none; padding: 0; margin-bottom: 32px;">
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ 25 Endpoints Max</li>
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ 90 Day History</li>
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ Email + Slack Alerts</li>
          <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">✓ Priority Support</li>
        </ul>
        ${isPro ? `
          <div style="margin-bottom: 16px; font-size: 14px; color: var(--text-muted);">Next billing: ${subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : 'N/A'}</div>
          <button class="btn" style="width: 100%; border: 1px solid #ef4444; color: #ef4444; background: none;">Cancel Subscription</button>
        ` : `
          <form action="/billing/upgrade" method="POST">
            <input type="hidden" name="csrf_token" value="${user.csrf_token}">
            <button type="submit" class="btn btn-primary" style="width: 100%;">Upgrade to Pro</button>
          </form>
        `}
      </div>
    </div>

    <div class="card">
      <h2>Payment History</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${history.length > 0 ? history.map(h => `
            <tr>
              <td>\${h.date}</td>
              <td>\${h.amount}</td>
              <td><span class="badge" style="background: #10b98120; color: #10b981;">\${h.status}</span></td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 40px;">No payments yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // We need to import dashboardLayout from server, but to avoid circular dep we'll just use a local one or move it to a common file
  // For now, I'll assume server.ts handles the rendering if I return the content
  return content;
};

export const upgradeHandler = async (c: Context) => {
  const user = c.get('user');
  const origin = new URL(c.req.url).origin;
  
  try {
    const data = await initializeTransaction(
      user.email,
      90000, // KES 900 in kobo
      { userId: user.id, plan: 'pro' },
      `${origin}/billing/verify?userId=${user.id}`
    );
    return c.redirect(data.authorization_url);
  } catch (error: any) {
    console.error('Upgrade failed:', error);
    return c.redirect('/billing?error=initialize');
  }
};

export const verifyBillingHandler = async (c: Context) => {
  const reference = c.req.query('reference');
  const userIdFromQuery = c.req.query('userId');
  
  if (!reference) return c.redirect('/billing?error=no_reference');

  try {
    const data = await verifyTransaction(reference);
    console.log('Paystack verification full response:', JSON.stringify(data, null, 2));

    if (data.status === 'success') {
      const userIdFromMetadata = data.metadata.userId;
      const plan = data.metadata.plan;
      
      // Validate userId from metadata against query to prevent tampering
      if (String(userIdFromMetadata) !== String(userIdFromQuery)) {
        console.error('UserId mismatch! Metadata:', userIdFromMetadata, 'Query:', userIdFromQuery);
        return c.redirect('/billing?error=security_mismatch');
      }

      console.log('Payment successful! Upgrading user', userIdFromMetadata, 'to', plan);
      dbCreateSubscription(userIdFromMetadata, plan, data.customer.customer_code, data.subscription_code || data.subscription);
      updateUserPlan(userIdFromMetadata, plan);
      
      return c.redirect('/billing?success=1');
    } else {
      console.warn('Payment verification failed status:', data.status);
    }
    return c.redirect('/billing?error=failed');
  } catch (error: any) {
    console.error('Verification exception:', error);
    return c.redirect('/billing?error=verify');
  }
};

export const webhookHandler = async (c: Context) => {
  const signature = c.req.header('x-paystack-signature');
  const body = await c.req.text();
  
  const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(body).digest('hex');
  
  if (hash !== signature) {
    return c.text('Invalid signature', 401);
  }

  const event = JSON.parse(body);
  
  if (isEventProcessed(event.data.id)) {
    return c.json({ status: 'ok' });
  }

  console.log('Processing Paystack webhook:', event.event);

  switch (event.event) {
    case 'charge.success':
      const userId = event.data.metadata.userId;
      updateUserPlan(userId, 'pro');
      updateSubscription(userId, { 
        status: 'active', 
        plan: 'pro',
        paystack_customer_id: event.data.customer.customer_code,
        paystack_subscription_code: event.data.subscription_code
      });
      break;
    case 'subscription.disable':
      // Downgrade user
      const sub = db.prepare('SELECT user_id FROM subscriptions WHERE paystack_subscription_code = ?').get(event.data.subscription_code) as any;
      if (sub) {
        updateUserPlan(sub.user_id, 'free');
        updateSubscription(sub.user_id, { status: 'cancelled', plan: 'free' });
      }
      break;
    case 'invoice.payment_failed':
      // Alert user
      break;
  }

  markEventProcessed(event.data.id);
  return c.json({ status: 'ok' });
};
