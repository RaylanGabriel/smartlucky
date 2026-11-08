import "server-only";

function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Envia o e-mail de confirmação. Nunca lança erro (só registra no log). */
export async function enviarEmailConfirmacao(
  email: string,
  numeros: Array<number | string>,
  paymentId: string
): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[email] BREVO_API_KEY não configurada");
    return false;
  }

  // Use um remetente de domínio próprio verificado no Brevo
  // para os e-mails não caírem no spam.
  const senderEmail =
    process.env.BREVO_SENDER_EMAIL ?? "raylanmiranda1@gmail.com";

  const listaNumeros = escapeHtml(
    [...numeros]
      .map(Number)
      .sort((a, b) => a - b)
      .join(" - ")
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "SmartLucky Rifa", email: senderEmail },
        to: [{ email }],
        subject: "🎉 Seus números da sorte chegaram!",
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #09090A; color: #ffffff; padding: 20px; border-radius: 10px;">
            <h1 style="color: #8257E5; text-align: center;">Pagamento Confirmado!</h1>
            <p style="text-align: center;">Olá! Seu pagamento foi processado com sucesso e seus números já estão garantidos.</p>
            <div style="background-color: #121214; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 1px solid #27272A;">
              <p style="font-size: 14px; color: #9CA3AF; margin-bottom: 10px;">SEUS NÚMEROS:</p>
              <p style="font-size: 24px; font-weight: bold; color: #10B981; letter-spacing: 2px;">${listaNumeros}</p>
            </div>
            <p style="font-size: 12px; color: #6B7280; text-align: center;">ID do Pagamento: ${escapeHtml(paymentId)}</p>
            <hr style="border: 0; border-top: 1px solid #27272A; margin: 20px 0;">
            <p style="text-align: center; font-size: 14px;">🍀 Boa sorte no sorteio!</p>
          </div>
        `,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        "[email] Brevo respondeu",
        response.status,
        await response.text().catch(() => "")
      );
      return false;
    }
    console.log(`[email] Confirmação enviada (pagamento ${paymentId})`);
    return true;
  } catch (err) {
    console.error(
      "[email] Falha no envio:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
