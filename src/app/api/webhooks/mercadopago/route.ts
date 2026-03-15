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

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "SmartLucky Rifa", email: "raylanmiranda1@gmail.com" }, 
        to: [{ email: email }],
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
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Erro ao enviar e-mail Brevo:", errorData);
    } else {
      console.log("E-mail de confirmação enviado para:", email);
    }
  } catch (err) {
    console.error("Erro crítico no envio de e-mail:", err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MercadoPagoWebhook;
    const paymentid = body.data?.id ?? body.id;

    if (!paymentid) {
      console.warn("Webhook recebido sem payment id", body);
      return NextResponse.json({ message: "Webhook sem id" }, { status: 400 });
    }

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentid}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error("Erro ao buscar pagamento MP:", response.status, errorBody);
      return NextResponse.json({ message: "Erro ao consultar pagamento" }, { status: response.status === 401 ? 401 : 500 });
    }

    const paymentData = await response.json();
    let statusTraduzido = paymentData.status;

    if (paymentData.status === "approved") {
      statusTraduzido = "pago";
    } else if (paymentData.status === "pending") {
      statusTraduzido = "pendente";
    } else if (paymentData.status === "rejected") {
      statusTraduzido = "recusado";
    } else if (paymentData.status === "in_process") {
      statusTraduzido = "em_processamento";
    }

    const { data: updatedRifas, error } = await supabase
      .from("rifas")
      .update({
        status: statusTraduzido,
        payment_info: paymentData,
      })
      .eq("payment_id", String(paymentid))
      .select("email, numero_escolhido, numeros");

    if (error) {
      console.error("Erro Supabase:", error);
      return NextResponse.json({ message: "Erro no banco" }, { status: 500 });
    }

    if (updatedRifas && Array.isArray(updatedRifas) && updatedRifas.length > 0) {
      const first = updatedRifas[0];
      const email = first.email;
      const numerosExtraidos: unknown[] = updatedRifas.flatMap((r: { numero_escolhido?: unknown; numeros?: unknown }) => {
        if (r.numero_escolhido !== undefined && r.numero_escolhido !== null) return [r.numero_escolhido];
        if (r.numeros !== undefined && r.numeros !== null) return Array.isArray(r.numeros) ? r.numeros : [r.numeros];
        return [];
      });

      if (statusTraduzido === "pago" && email) {
        await enviarEmailBrevo(email, numerosExtraidos, String(paymentid));
      }
    }

    return NextResponse.json({ message: "Recebido" }, { status: 200 });
  } catch (err) {
    console.error("Erro Webhook:", err);
    return NextResponse.json({ message: "Erro interno" }, { status: 500 });
  }
}