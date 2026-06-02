export const emailVerificationTemplate = ({ username, otp }) => {
  const safeUsername = username || "there";

  return {
    subject: "Your Billxpress verification code",
    textContent: `Hi ${safeUsername}, your Billxpress verification code is ${otp}. This code expires in 10 minutes.`,
    htmlContent: `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#fff7ed;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
            <div style="background:#ffffff;border:1px solid #fed7aa;border-top:5px solid #f97316;border-radius:8px;padding:28px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#f97316;text-transform:uppercase;">Billxpress</p>
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827;">Verify your email</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Hi ${safeUsername}, welcome to Billxpress. Use this code to verify your email address.</p>
              <div style="margin:0 0 18px;padding:16px 18px;background:#ffedd5;border:1px solid #fdba74;border-radius:6px;font-size:30px;font-weight:700;letter-spacing:4px;text-align:center;color:#9a3412;">${otp}</div>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">This code expires in 10 minutes. If you did not create a Billxpress account, you can ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};
