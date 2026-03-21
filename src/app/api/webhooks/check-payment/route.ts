import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type MercadoPagoPayment = {
  status: string;
  payer?: { email?: string };
  metadata?: { numeros?: string };
};

async function enviarEmailBrevo(
  email: string,
  numeros: unknown[],
  paymentId: string
) {
  try {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (!BREVO_API_KEY) {
      console.error("Chave do Brevo não configurada no .env");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "SmartLucky Rifa",
            email: "raylanmiranda1@gmail.com",
          },
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
    console.error(
      "Erro no envio de e-mail:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const paymentId = searchParams.get("payment_id");

  if (!paymentId) {
    return NextResponse.json(
      { error: "payment_id é obrigatório" },
      { status: 400 }
    );
  }

  console.log(`📋 [CHECK-PAYMENT] Checando pagamento: ${paymentId}`);

  try {
    // 1. Verificar status atual na tabela rifas
    const { data: rifaData, error: rifaError } = await supabase
      .from("rifas")
      .select("status, email, numero_escolhido")
      .eq("payment_id", paymentId)
      .single();

    if (rifaError && rifaError.code !== "PGRST116") {
      console.error("Erro ao buscar rifa:", rifaError);
      return NextResponse.json(
        { error: "Erro ao buscar status do pagamento" },
        { status: 500 }
      );
    }

    // Se já está aprovado/pago, retorna sucesso
    if (rifaData?.status === "pago") {
      console.log(`✅ [CHECK-PAYMENT] Pagamento ${paymentId} já processado`);
      return NextResponse.json({
        payment_id: paymentId,
        status: "approved",
        message: "Pagamento já processado",
      });
    }

    // 2. Se não foi processado ainda, tenta processar agora
    console.log(
      `⏳ [CHECK-PAYMENT] Tentando processar pagamento pendente: ${paymentId}`
    );

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) {
      throw new Error("MP_ACCESS_TOKEN não configurado");
    }

    // Fetch payment details from Mercado Pago
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
      }
    );

    if (!mpResponse.ok) {
      console.error(
        `❌ [CHECK-PAYMENT] Erro ao buscar pagamento no MP: ${mpResponse.status}`
      );
      return NextResponse.json(
        { payment_id: paymentId, status: "pending" },
        { status: 200 }
      );
    }

    const paymentData = (await mpResponse.json()) as MercadoPagoPayment;
    console.log(
      `💰 [CHECK-PAYMENT] Status no MP: ${paymentData.status} para ${paymentId}`
    );

    // 3. Se o pagamento foi aprovado, atualizar no banco
    if (paymentData.status === "approved") {
      console.log(`✨ [CHECK-PAYMENT] Processando pagamento aprovado: ${paymentId}`);

      // Update rifas table
      const { error: updateError } = await supabase
        .from("rifas")
        .update({
          status: "pago",
          payment_info: paymentData,
        })
        .eq("payment_id", paymentId);

      if (updateError) {
        console.error("Erro ao atualizar rifas:", updateError);
      } else {
        console.log(`✅ [CHECK-PAYMENT] Rifa atualizada para pago: ${paymentId}`);

        // Extract email and payment numbers
        const email = paymentData.payer?.email || rifaData?.email;
        let numeros: string[] = [];
        
        if (rifaData?.numero_escolhido) {
          // Handle both string and array formats
          if (typeof rifaData.numero_escolhido === "string") {
            numeros = rifaData.numero_escolhido
              .split(",")
              .map((n: string) => n.trim());
          } else if (Array.isArray(rifaData.numero_escolhido)) {
            numeros = rifaData.numero_escolhido.map((n: unknown) => 
              typeof n === "string" ? n : String(n)
            );
          } else {
            numeros = [String(rifaData.numero_escolhido)];
          }
        }

        // Send confirmation email
        if (email) {
          await enviarEmailBrevo(email, numeros, paymentId);
        }

        // Mark as processed in webhook_queue
        await supabase
          .from("webhook_queue")
          .update({ status: "processed" })
          .eq("payment_id", paymentId);
      }

      return NextResponse.json({
        payment_id: paymentId,
        status: "approved",
        message: "Pagamento processado com sucesso",
      });
    }

    // Payment still pending
    return NextResponse.json({
      payment_id: paymentId,
      status: "pending",
      message: "Pagamento ainda não foi confirmado",
    });
  } catch (err) {
    console.error(
      `❌ [CHECK-PAYMENT] Erro geral:`,
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "Erro ao processar requisição" },
      { status: 500 }
    );
  }
}
