const BRAND = {
  name: "Billxpress",
  orange: "#f97316",
  orangeDark: "#c2410c",
  orangeSoft: "#fff7ed",
  border: "#fed7aa",
  text: "#111827",
  muted: "#6b7280",
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getSocialLinks = () => [
  {
    label: "X",
    url: process.env.BILLXPRESS_X_URL,
  },
  {
    label: "IG",
    url: process.env.BILLXPRESS_INSTAGRAM_URL,
  },
  {
    label: "FB",
    url: process.env.BILLXPRESS_FACEBOOK_URL,
  },
  {
    label: "IN",
    url: process.env.BILLXPRESS_LINKEDIN_URL,
  },
];

const renderSocialLinks = () => {
  const links = getSocialLinks().filter((link) => link.url);

  if (links.length === 0) {
    return "";
  }

  return `
    <tr>
      <td align="center" style="padding:18px 0 0;">
        ${links
          .map(
            (link) => `
              <a href="${escapeHtml(link.url)}" style="display:inline-block;margin:0 4px;width:32px;height:32px;line-height:32px;border-radius:999px;background:${BRAND.orange};color:#ffffff;font-size:11px;font-weight:700;text-align:center;text-decoration:none;">
                ${escapeHtml(link.label)}
              </a>
            `
          )
          .join("")}
      </td>
    </tr>
  `;
};

export const billxpressEmailLayout = ({
  title,
  preheader,
  greeting,
  body,
  action,
  footerNote,
}) => {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || title);
  const safeGreeting = greeting ? escapeHtml(greeting) : null;
  const safeFooterNote = footerNote ? escapeHtml(footerNote) : null;
  const actionHtml = action?.url
    ? `
      <tr>
        <td style="padding:4px 0 24px;">
          <a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.orange};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 18px;border-radius:6px;">
            ${escapeHtml(action.label || "Open Billxpress")}
          </a>
        </td>
      </tr>
    `
    : "";

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:${BRAND.orangeSoft};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          ${safePreheader}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.orangeSoft};margin:0;padding:0;">
          <tr>
            <td align="center" style="padding:32px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="background:${BRAND.orange};padding:22px 28px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <div style="display:inline-block;width:42px;height:42px;line-height:42px;border-radius:10px;background:#ffffff;color:${BRAND.orangeDark};font-weight:800;font-size:22px;text-align:center;">B</div>
                          <span style="display:inline-block;margin-left:10px;color:#ffffff;font-weight:800;font-size:21px;vertical-align:middle;">${BRAND.name}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px 8px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:${BRAND.orangeDark};">${BRAND.name}</p>
                    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:${BRAND.text};">${safeTitle}</h1>
                    ${
                      safeGreeting
                        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BRAND.text};">${safeGreeting}</p>`
                        : ""
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 12px;font-size:15px;line-height:1.7;color:${BRAND.text};">
                    ${body}
                  </td>
                </tr>
                ${actionHtml}
                ${
                  safeFooterNote
                    ? `
                      <tr>
                        <td style="padding:0 28px 28px;">
                          <div style="background:#fff7ed;border:1px solid ${BRAND.border};border-radius:8px;padding:14px 16px;color:${BRAND.muted};font-size:13px;line-height:1.6;">
                            ${safeFooterNote}
                          </div>
                        </td>
                      </tr>
                    `
                    : ""
                }
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">
                ${renderSocialLinks()}
                <tr>
                  <td align="center" style="padding:16px 24px 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">
                    You received this email because you use ${BRAND.name}. Please ignore it if this action was not started by you.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

export const notificationEmailTemplate = ({
  name,
  title,
  message,
  action,
  footerNote,
}) => {
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

  return {
    subject: title,
    textContent: message,
    htmlContent: billxpressEmailLayout({
      title,
      preheader: message,
      greeting: `Hi ${name || "there"},`,
      body: `<p style="margin:0 0 18px;">${safeMessage}</p>`,
      action,
      footerNote,
    }),
  };
};

export const emailVerificationTemplate = ({ username, otp }) => {
  const safeUsername = username || "there";

  return {
    subject: "Your Billxpress verification code",
    textContent: `Hi ${safeUsername}, your Billxpress verification code is ${otp}. This code expires in 10 minutes.`,
    htmlContent: billxpressEmailLayout({
      title: "Verify your email",
      preheader: `Your Billxpress verification code is ${otp}`,
      greeting: `Hi ${safeUsername}, welcome to Billxpress.`,
      body: `
        <p style="margin:0 0 18px;">Use this code to verify your email address.</p>
        <div style="margin:0 0 18px;padding:18px 20px;background:#ffedd5;border:1px solid #fdba74;border-radius:8px;font-size:32px;font-weight:800;letter-spacing:5px;text-align:center;color:${BRAND.orangeDark};">
          ${escapeHtml(otp)}
        </div>
      `,
      footerNote:
        "This code expires in 10 minutes. If you did not create a Billxpress account, you can ignore this email.",
    }),
  };
};
