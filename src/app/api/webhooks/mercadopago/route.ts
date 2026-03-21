import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type MercadoPagoWebhook = {
  id?: string | number;
  type?: string;
  action?: string;
  data?: { id?: number | string };
};

async function enviarEmailBrevo(email: string, numeros: unknown[], paymentId: string) {
  try {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      console.error("Chave do Brevo não configurada no .env");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 segundos de timeout
    
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "SmartLucky Rifa", email: "raylanmiranda1@gmail.com" },
          to: [{ email }],
          subject: "🎉 Seus números da sorte chegaram!",
          htmlContent: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #09090A; color: #ffffff; padding: 20px; border-radius: 10px;">
              <h1 style="color: #8257E5; text-align: center;">Pagamento Confirmado!</h1>
              <p style="text-align: center;">Olá! Seu pagamento foi processado com sucesso e seus números já estão garantidos.</p>
              <div style="background-color: #121214; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 1px solid #27272A;">
                <p style="font-size: 14px; color: #9CA3AF; margin-bottom: 10px;">SEUS NÚMEROS:</p>
                <p style="font-size: 24px; font-weight: bold; color: #10B981; letter-spacing: 2px;">
                  ${Array.isArray(numeros) ? numeros.join(" - ") : numeros}
                </p>
              </div>
              <p style="font-size: 12px; color: #6B7280; text-align: center;">ID do Pagamento: ${paymentId}</p>
              <hr style="border: 0; border-top: 1px solid #27272A; margin: 20px 0;">
              <p style="text-align: center; font-size: 14px;">🍀 Boa sorte no sorteio!</p>
            </div>
          `,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Erro ao enviar e-mail Brevo:", errorData);
      } else {
        console.log("E-mail enviado com sucesso para:", email);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.error("Erro no envio de e-mail:", err instanceof Error ? err.message : String(err));
  }
}

export async function POST(request: Request) {
  console.log("🔔 WEBHOOK recebido");
  
  try {
    const bodyText = await request.text();
    
    // EXTRAIR PAYMENT ID RAPIDAMENTE
    let body: MercadoPagoWebhook | null = null;

    if (bodyText.trim().length > 0) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        const idFromData = bodyText.match(/data\s*:\s*\{[^}]*id\s*:\s*"?([0-9]+)"?/);
        const parsedId = idFromData?.[1];
        if (parsedId) {
          body = { id: parsedId, data: { id: parsedId } };
        }
      }
    }

    const paymentid = body?.data?.id ?? body?.id;
    if (!paymentid) {
      return NextResponse.json({ message: "Ok" }, { status: 200 });
    }

    console.log("Payment ID:", String(paymentid));

    // ✅ SALVAR NA FILA (NÃO PROCESSA AQUI)
    const queueEntry = {
      payment_id: String(paymentid),
      status: "pending",
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    
    console.log("Salvando na fila...");
    const { error: queueError } = await supabase
      .from("webhook_queue")
      .upsert(queueEntry, { onConflict: "payment_id" });

    if (queueError) {
      console.error("❌ Erro ao salvar na fila:", queueError.message);
      // Mesmo com erro, retorna 200 para MP não retentar
      return NextResponse.json({ message: "Ok" }, { status: 200 });
    }

    console.log("✅ Salvo na fila para processar");
    return NextResponse.json({ message: "Ok" }, { status: 200 });

  } catch (err) {
    console.error("Erro no webhook:", err);
    return NextResponse.json({ message: "Ok" }, { status: 200 });
  }
}

// Exportar função para usar em outros lugares
export async function enviarEmailBrevoExportado(
  email: string,
  numeros: unknown[],
  paymentId: string
) {
  return enviarEmailBrevo(email, numeros, paymentId);
}