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
  // ✅ LOG IMEDIATO - PRIMEIRA COISA
  console.log("🔔 [WEBHOOK RECEBIDO]", new Date().toISOString());
  console.log("URL:", request.url);
  console.log("Method:", request.method);
  
  try {
    const bodyText = await request.text();
    
    console.log("Body length:", bodyText.length);
    console.log("Body preview:", bodyText.substring(0, 150));
    
    // EXTRAIR PAYMENT ID RAPIDAMENTE
    let body: MercadoPagoWebhook | null = null;

    if (bodyText.trim().length > 0) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        const idFromData = bodyText.match(/data\s*:\s*\{[^}]*id\s*:\s*"?([0-9]+)"?/);
        const idFromRoot = bodyText.match(/id\s*:\s*"?([0-9]+)"?/);
        
        const parsedId = idFromData?.[1] ?? idFromRoot?.[1];
        if (parsedId) {
          body = { id: parsedId, data: { id: parsedId } };
        }
      }
    }

    // Extrair payment ID
    let paymentid = body?.data?.id ?? body?.id;
    if (!paymentid) {
      console.log("⚠️ [WEBHOOK] Sem payment ID");
      return NextResponse.json({ message: "Ok" }, { status: 200 });
    }

    paymentid = String(paymentid);
    console.log(`✅ [WEBHOOK] Payment ID: ${paymentid}`);

    // ✅ RETORNAR 200 OK IMEDIATAMENTE
    // Processor everything in background after returning
    const responsePromise = NextResponse.json({ message: "Ok" }, { status: 200 });

    // ✅ PROCESSAR TUDO EM BACKGROUND (não bloqueia)
    processarWebhookEmBackground(paymentid).catch((err) => {
      console.error("Erro ao processar webhook em background:", err);
    });

    return responsePromise;

  } catch (err) {
    console.error("Erro crítico no webhook:", err);
    return NextResponse.json({ message: "Ok" }, { status: 200 });
  }
}

// ✅ FUNÇÃO ASSÍNCRONA QUE PROCESSA TUDO EM BACKGROUND
async function processarWebhookEmBackground(paymentid: string) {
  const startTime = Date.now();
  
  try {
    console.log("=== WEBHOOK INICIANDO PROCESSAMENTO ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Payment ID:", paymentid);

    // ✅ VERIFICAR AMBIENTE
    if (!process.env.MP_ACCESS_TOKEN) {
      console.error("ERRO: MP_ACCESS_TOKEN não configurado!");
      return;
    }

    // ✅ BUSCAR STATUS NO MERCADO PAGO
    console.log("Consultando Mercado Pago para ID:", paymentid);
    console.log("Token presente:", !!process.env.MP_ACCESS_TOKEN);
    
    const url = `https://api.mercadopago.com/v1/payments/${paymentid}`;

    let response;
    try {
      console.log("⏳ Enviando fetch simples...");
      
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
      
      console.log("✅ Resposta recebida!");
      console.log("Status HTTP:", response.status);
      
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error("❌ Erro no fetch:", errorMsg);
      return;
    }

    if (!response.ok) {
      console.error("❌ Status não OK:", response.status);
      return;
    }

    console.log("📦 Extraindo texto da resposta...");
    const text = await response.text();
    console.log("✅ Texto extraído. Comprimento:", text.length);
    
    console.log("📦 Parseando JSON...");
    let paymentData;
    try {
      paymentData = JSON.parse(text);
      console.log("✅ JSON parseado!");
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("❌ Erro ao parsear JSON:", msg);
      return;
    }
    
    console.log("📊 Status do pagamento:", paymentData.status);

    // ✅ VERIFICAR STATUS
    if (paymentData.status !== "approved") {
      console.log("⏸️ Status não é 'approved'. Atual:", paymentData.status);
      return;
    }

    console.log("✅ Status é APPROVED! Atualizando banco...");
    console.log("Update: status='pago', payment_id='" + paymentid + "'");

    const { data: updatedRifas, error } = await supabase
      .from("rifas")
      .update({
        status: "pago",
        payment_info: paymentData,
      })
      .eq("payment_id", paymentid)
      .select("email, numero_escolhido, id");

    if (error) {
      console.error("❌ Erro Supabase:", error.message);
      return;
    }

    const linhasAtualizadas = updatedRifas?.length ?? 0;
    console.log(`✅ Sucesso! ${linhasAtualizadas} linhas atualizadas`);

    // ✅ ENVIAR EMAIL
    if (updatedRifas && updatedRifas.length > 0) {
      const email = updatedRifas[0].email;
      const numerosExtraidos: unknown[] = updatedRifas.flatMap(
        (r: { numero_escolhido?: unknown }) => {
          if (r.numero_escolhido !== undefined && r.numero_escolhido !== null) {
            return [r.numero_escolhido];
          }
          return [];
        }
      );

      console.log("📧 Enviando email para:", email);
      try {
        await enviarEmailBrevo(email, numerosExtraidos, paymentid);
        console.log("✅ Email enviado!");
      } catch (emailError) {
        console.error("⚠️ Erro ao enviar email:", emailError instanceof Error ? emailError.message : String(emailError));
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ WEBHOOK SUCESSO (${totalTime}ms)`);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("❌ ERRO CRÍTICO:", errorMsg);
    if (err instanceof Error) {
      console.error("Stack:", err.stack);
    }
  }
}