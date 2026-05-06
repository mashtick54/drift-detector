import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendBreakingChangeAlert(endpointName: string, diffs: any[]) {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail || !process.env.RESEND_API_KEY) {
    console.warn('Skipping alert email: ALERT_EMAIL or RESEND_API_KEY not set.');
    return;
  }

  const diffList = diffs.map(d => {
    let color = 'black';
    if (d.severity === 'breaking') color = 'red';
    else if (d.severity === 'warning') color = 'orange';
    else if (d.severity === 'info') color = 'green';

    return `<li style="color: ${color}">
      <strong>${d.path}</strong>: ${d.changeType} (${d.severity})
    </li>`;
  }).join('');

  const html = `
    <h1>Breaking change detected: ${endpointName}</h1>
    <p>The following changes were detected in the API schema:</p>
    <ul>
      ${diffList}
    </ul>
  `;

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: alertEmail,
      subject: `Breaking change detected: ${endpointName}`,
      html: html,
    });
    console.log(`Alert email sent for ${endpointName} to ${alertEmail}`);
  } catch (error) {
    console.error(`Failed to send alert email for ${endpointName}:`, error);
  }
}
