import { Resend } from "resend";
import { env } from "./env";

// Initialize Resend client (lazy initialization to handle missing API key gracefully)
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const client = getResendClient();

  if (!client) {
    console.log(
      `[Mock Email] To: ${options.to}, Subject: ${options.subject}`
    );
    return false;
  }

  try {
    const fromEmail = env.RESEND_FROM_EMAIL || "noreply@pluto.trainy.ai";

    const result = await client.emails.send({
      from: fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (result.error) {
      console.error("Failed to send email:", result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}
