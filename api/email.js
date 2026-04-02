export async function sendEmail(email, name, link, ref, type) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Your Store <onboarding@resend.dev>",
      to: email,
      subject: type === "PRINT" 
        ? "Your Print Order Confirmation" 
        : "Your Wedding Tag PDF",
      html: `
        <h2>Hi ${name},</h2>
        ${
          type === "PRINT"
            ? `<p>Your order is confirmed! Ref#: ${ref}</p>`
            : `<p>Your PDF is ready:</p><a href="${link}">Download here</a>`
        }
      `
    })
  });
}