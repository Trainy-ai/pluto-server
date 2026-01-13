import { env } from "../env";

export interface InvitationEmailData {
  inviterName: string;
  inviterEmail: string;
  organizationName: string;
  inviteeEmail: string;
  role: string;
  expiresAt: Date;
}

export function generateInvitationEmail(data: InvitationEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = env.BETTER_AUTH_URL;
  const inviteLink = `${appUrl}/o?invite=pending`;

  const expiresFormatted = data.expiresAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `You've been invited to join ${data.organizationName} on Pluto`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Organization Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">You're Invited!</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      <strong>${data.inviterName}</strong> (${data.inviterEmail}) has invited you to join
      <strong>${data.organizationName}</strong> as a <strong>${data.role.toLowerCase()}</strong>.
    </p>

    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <p style="margin: 0 0 15px 0;">To accept this invitation:</p>
      <ol style="margin: 0; padding-left: 20px;">
        <li>Sign in to Pluto (or create an account with this email: ${data.inviteeEmail})</li>
        <li>You'll see the pending invitation on your dashboard</li>
        <li>Click "Accept" to join the organization</li>
      </ol>
    </div>

    <a href="${inviteLink}" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; margin: 10px 0;">
      View Invitation
    </a>

    <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
      This invitation expires on ${expiresFormatted}.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="font-size: 12px; color: #9ca3af; margin: 0;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
You're Invited to ${data.organizationName}!

${data.inviterName} (${data.inviterEmail}) has invited you to join ${data.organizationName} as a ${data.role.toLowerCase()}.

To accept this invitation:
1. Sign in to Pluto at ${inviteLink} (or create an account with this email: ${data.inviteeEmail})
2. You'll see the pending invitation on your dashboard
3. Click "Accept" to join the organization

This invitation expires on ${expiresFormatted}.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();

  return { subject, html, text };
}
