const BRAND = {
  name: "BillXpress",
  orange: "#f97316",
  orangeDark: "#c2410c",
  orangeSoft: "#fff3e8",
  orangeLight: "#ffedd5",
  navy: "#2f2418",
  pageBg: "#fff8f1",
  border: "#fed7aa",
  text: "#243746",
  muted: "#64748b",
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getSupportEmail = () =>
  process.env.BILLXPRESS_SUPPORT_EMAIL || "support@billxpress.com";

const getSupportPhone = () => process.env.BILLXPRESS_SUPPORT_PHONE || "";

const getSupportUrl = () =>
  process.env.BILLXPRESS_SUPPORT_URL ||
  `mailto:${getSupportEmail()}?subject=BillXpress%20Support`;

const getLogoUrl = () => process.env.BILLXPRESS_LOGO_URL || "";

const getStoreLinks = () => [
  {
    label: "App Store",
    url: process.env.BILLXPRESS_APP_STORE_URL || "",
  },
  {
    label: "Google Play",
    url: process.env.BILLXPRESS_PLAY_STORE_URL || "",
  },
];

const getSocialLinks = () => [
  {
    label: "Facebook",
    iconText: "f",
    url:
      process.env.BILLXPRESS_FACEBOOK_URL ||
      "https://facebook.com/billxpress",
  },
  {
    label: "X",
    iconText: "X",
    url: process.env.BILLXPRESS_X_URL || "https://x.com/billxpress",
  },
  {
    label: "Instagram",
    iconText: "IG",
    url:
      process.env.BILLXPRESS_INSTAGRAM_URL ||
      "https://instagram.com/billxpress",
  },
  {
    label: "LinkedIn",
    iconText: "in",
    url:
      process.env.BILLXPRESS_LINKEDIN_URL ||
      "https://linkedin.com/company/billxpress",
  },
];

const renderLogo = () => {
  const logoUrl = getLogoUrl();

  if (logoUrl) {
    return `
      <img src="${escapeHtml(logoUrl)}" alt="${BRAND.name}" width="170" style="display:block;border:0;max-width:170px;height:auto;">
    `;
  }

  return `
    <table role="presentation" cellspacing="0" cellpadding="0">
      <tr>
        <td style="width:46px;height:46px;border-radius:11px;background:${BRAND.orange};color:#ffffff;font-size:28px;font-weight:800;line-height:46px;text-align:center;">B</td>
        <td style="padding-left:10px;color:${BRAND.navy};font-size:30px;line-height:34px;font-weight:800;">${BRAND.name}</td>
      </tr>
    </table>
  `;
};

const renderStoreLinks = () => {
  const links = getStoreLinks().filter((link) => link.url);

  if (links.length === 0) {
    return "";
  }

  return links
    .map(
      (link) => `
        <a href="${escapeHtml(link.url)}" style="display:inline-block;margin-left:8px;padding:7px 12px;border-radius:4px;background:#000000;color:#ffffff;font-size:11px;line-height:14px;font-weight:700;text-decoration:none;">${escapeHtml(link.label)}</a>
      `
    )
    .join("");
};

const renderSocialLinks = () => {
  const links = getSocialLinks().filter((link) => link.url);

  if (links.length === 0) {
    return "";
  }

  return `
    <div style="padding-top:16px;">
      ${links
        .map(
          (link) => `
            <a href="${escapeHtml(link.url)}" aria-label="${escapeHtml(link.label)}" style="display:inline-block;margin-right:8px;width:27px;height:27px;border-radius:999px;background:${BRAND.navy};color:#ffffff;font-size:11px;font-weight:800;line-height:27px;text-align:center;text-decoration:none;">${escapeHtml(link.iconText)}</a>
          `
        )
        .join("")}
    </div>
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
  const supportEmail = getSupportEmail();
  const supportPhone = getSupportPhone();
  const supportUrl = getSupportUrl();
  const storeLinks = renderStoreLinks();
  const actionHtml = action?.url
    ? `
      <p style="margin:18px 0 4px;">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.orange};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 16px;border-radius:4px;">
          ${escapeHtml(action.label || `Open ${BRAND.name}`)}
        </a>
      </p>
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
      <body style="margin:0;padding:0;background:${BRAND.pageBg};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          ${safePreheader}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.pageBg};margin:0;padding:0;">
          <tr>
            <td align="center" style="padding:8px 10px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:500px;background:#ffffff;border-top:4px solid ${BRAND.orange};">
                <tr>
                  <td style="background:${BRAND.orangeSoft};padding:42px 32px 40px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="58%" valign="middle" style="vertical-align:middle;">
                          ${renderLogo()}
                        </td>
                        <td width="14%" align="center" valign="middle" style="vertical-align:middle;color:${BRAND.orange};font-size:46px;line-height:46px;font-weight:300;">&gt;</td>
                        <td width="28%" align="right" valign="middle" style="vertical-align:middle;color:#1f2937;font-size:12px;line-height:16px;">
                          <strong>Need Help?</strong><br>
                          <a href="${escapeHtml(supportUrl)}" style="color:#0b65c2;text-decoration:none;">Click here</a> for support
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 33px 56px;color:#374151;font-size:14px;line-height:19px;">
                    ${
                      safeGreeting
                        ? `<p style="margin:0 0 12px;color:#374151;">${safeGreeting}</p>`
                        : ""
                    }
                    <h1 style="margin:0 0 14px;color:${BRAND.navy};font-size:20px;line-height:26px;font-weight:800;">${safeTitle}</h1>
                    ${body}
                    ${actionHtml}
                    ${
                      safeFooterNote
                        ? `<p style="margin:18px 0 0;padding:11px 13px;background:#fff7ed;border-left:3px solid ${BRAND.orange};color:#5f6b7a;font-size:12px;line-height:18px;">${safeFooterNote}</p>`
                        : ""
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:23px 25px 20px;">
                    <p style="margin:0 0 16px;color:#374151;font-size:11px;line-height:16px;">
                      If you have questions/complaints as regards this transaction, please reply this email or send email to
                      <a href="mailto:${escapeHtml(supportEmail)}" style="color:#005bd8;text-decoration:none;">${escapeHtml(supportEmail)}</a>
                    </p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${BRAND.border};">
                      <tr>
                        <td valign="top" style="padding-top:18px;color:#000000;font-size:11px;line-height:18px;">
                          <a href="mailto:${escapeHtml(supportEmail)}" style="color:#005bd8;text-decoration:none;">${escapeHtml(supportEmail)}</a><br>
                          ${supportPhone ? escapeHtml(supportPhone) : ""}
                          ${renderSocialLinks()}
                        </td>
                        <td align="right" valign="top" style="padding-top:18px;white-space:nowrap;">
                          ${storeLinks}
                        </td>
                      </tr>
                    </table>
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
      body: `<p style="margin:0;">${safeMessage}</p>`,
      action,
      footerNote,
    }),
  };
};

export const emailVerificationTemplate = ({ username, otp }) => {
  const safeUsername = username || "there";

  return {
    subject: `Your ${BRAND.name} verification code`,
    textContent: `Hi ${safeUsername}, your ${BRAND.name} verification code is ${otp}. This code expires in 10 minutes.`,
    htmlContent: billxpressEmailLayout({
      title: "Verify your email",
      preheader: `Your ${BRAND.name} verification code is ${otp}`,
      greeting: `Hi ${safeUsername}, welcome to ${BRAND.name}.`,
      body: `
        <p style="margin:0 0 14px;">Use this code to verify your email address.</p>
        <div style="margin:0;padding:14px 18px;background:#fff7ed;border:1px solid #fdba74;font-size:30px;font-weight:800;letter-spacing:5px;text-align:center;color:${BRAND.orangeDark};">
          ${escapeHtml(otp)}
        </div>
      `,
      footerNote:
        `This code expires in 10 minutes. If you did not create a ${BRAND.name} account, you can ignore this email.`,
    }),
  };
};
