const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

export const sendEmail = async ({ to, name, subject, htmlContent, textContent }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Billxpress";

  if (!apiKey || !senderEmail) {
    throw new Error("Brevo email credentials are not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(BREVO_EMAIL_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: to,
            name,
          },
        ],
        subject,
        htmlContent,
        textContent,
        tags: ["auth", "email-verification"],
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = result.message || "Email provider rejected the request";
      const message =
        providerMessage.toLowerCase() === "key not found"
          ? "Brevo API key is invalid or not active"
          : providerMessage;

      throw new Error(`${message} (Brevo status ${response.status})`);
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
};
