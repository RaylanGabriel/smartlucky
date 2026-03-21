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
  const startTime = Date.now();
  
  try {
    // LOG INICIAL
    const bodyText = await request.text();
    console.log("=== WEBHOOK MERCADO PAGO ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Webhook raw body:", bodyText.substring(0, 200));

    let body: MercadoPagoWebhook | null = null;

    if (bodyText.trim().length > 0) {
      try {
        body = JSON.parse(bodyText);
        console.log("JSON parseado com sucesso:", JSON.stringify(body).substring(0, 200));
      } catch (parseError) {
        console.error("Erro ao parsear JSON:", parseError);
        console.log("Tentando fallback regex...");

        const idFromData = bodyText.match(/data\s*:\s*\{[^}]*id\s*:\s*"?([0-9]+)"?/);
        const idFromRoot = bodyText.match(/id\s*:\s*"?([0-9]+)"?/);
        const typeMatch = bodyText.match(/type\s*:\s*"?([a-zA-Z0-9_\.]+)"?/);
        const actionMatch = bodyText.match(/action\s*:\s*"?([a-zA-Z0-9_\.]+)"?/);

        const parsedId = idFromData?.[1] ?? idFromRoot?.[1];

        if (parsedId) {
          body = {
            id: parsedId,
            type: typeMatch?.[1],
            action: actionMatch?.[1],
            data: { id: parsedId },
          };
          console.log("Fallback regex bem-sucedido:", body);
        }
      }
    }

    if (!body) {
      console.warn("Webhook inválido - nenhum body encontrado");
      return NextResponse.json({ message: "Webhook inválido" }, { status: 400 });
    }

    console.log("Body type:", body.type);
    console.log("Body action:", body.action);

    // VERIFICAR TIPO
    if (body.type && body.type !== "payment") {
      console.log("Evento ignorado - tipo não é payment:", body.type);
      return NextResponse.json({ message: "Evento ignorado" }, { status: 200 });
    }

    // EXTRAIR PAYMENT ID COM VALIDAÇÃO
    let paymentid = body.data?.id ?? body.id;
    console.log("Payment ID extraído (raw):", paymentid, "tipo:", typeof paymentid);

    if (!paymentid) {
      console.warn("Webhook sem payment_id válido");
      return NextResponse.json({ message: "Webhook sem id" }, { status: 400 });
    }

    // GARANTIR STRING
    paymentid = String(paymentid);
    console.log("Payment ID (string):", paymentid);

    // VERIFICAR AMBIENTE
    if (!process.env.MP_ACCESS_TOKEN) {
      console.error("ERRO: MP_ACCESS_TOKEN não configurado!");
      return NextResponse.json({ message: "Servidor não configurado" }, { status: 500 });
    }

    // BUSCAR STATUS NO MERCADO PAGO COM TIMEOUT
    console.log("Consultando Mercado Pago para ID:", paymentid);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos de timeout
    
    let response;
    try {
      response = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentid}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          },
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error("Erro ao buscar pagamento MP:", {
        status: response.status,
        error: errorBody,
      });

      // Se for 404, o arquivo não existe no MP - erro permanente
      if (response.status === 404) {
        return NextResponse.json({ message: "Pagamento não encontrado no MP" }, { status: 404 });
      }

      return NextResponse.json({ message: "Erro ao consultar pagamento" }, { status: 500 });
    }

    const paymentData = await response.json();
    console.log("Status retornado do MP:", paymentData.status);
    console.log("Payment data keys:", Object.keys(paymentData).slice(0, 10));

    // VERIFICAR STATUS
    if (paymentData.status !== "approved") {
      console.log("Pagamento não aprovado - status atual:", paymentData.status);
      return NextResponse.json({ message: "Pagamento não aprovado ainda" }, { status: 200 });
    }

    const statusTraduzido = "pago";
    console.log("Status OK - Atualizando banco com status:", statusTraduzido);

    // QUERY COM .EQ() E LOG DETALHADO
    console.log("Executando query Supabase com payment_id:", paymentid);

    const { data: updatedRifas, error } = await supabase
      .from("rifas")
      .update({
        status: statusTraduzido,
        payment_info: paymentData,
      })
      .eq("payment_id", paymentid)
      .select("email, numero_escolhido, id");

    // LOG DE ERRO DO SUPABASE COM DETALHES
    if (error) {
      console.error("Erro Supabase completo:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json({ message: "Erro no banco" }, { status: 500 });
    }

    console.log("Resultado da atualização:", {
      linhasAfetadas: updatedRifas?.length ?? 0,
      dados: updatedRifas,
    });

    // VERIFICAR SE ATUALIZOU ALGUMA LINHA
    if (!updatedRifas || updatedRifas.length === 0) {
      console.warn("AVISO: Nenhuma linha foi atualizada no Supabase para payment_id:", paymentid);
      console.warn("Possível causa: payment_id não existe no banco ou em formato diferente");

      const elapsed = Date.now() - startTime;
      console.log(`Tempo total: ${elapsed}ms`);
      
      // NÃO faz debug aqui, retorna imediatamente para evitar timeout
      return NextResponse.json({ message: "Nenhum registro atualizado" }, { status: 200 });
    }

    const elapsed = Date.now() - startTime;
    console.log(`Tempo até update: ${elapsed}ms`);

    // ENVIAR EMAIL EM BACKGROUND (não bloqueia a resposta)
    if (updatedRifas && updatedRifas.length > 0) {
      const email = updatedRifas[0].email;
      console.log("Agendando envio de email para:", email);

      const numerosExtraidos: unknown[] = updatedRifas.flatMap(
        (r: { numero_escolhido?: unknown }) => {
          if (r.numero_escolhido !== undefined && r.numero_escolhido !== null) {
            return [r.numero_escolhido];
          }
          return [];
        }
      );

      if (email) {
        // Enviar email em background sem bloquear a resposta
        enviarEmailBrevo(email, numerosExtraidos, paymentid).catch((err) => {
          console.error("Erro ao enviar email em background:", err);
        });
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`=== WEBHOOK PROCESSADO COM SUCESSO (${totalTime}ms) ===`);
    return NextResponse.json({ message: "Recebido" }, { status: 200 });

  } catch (err) {
    console.error("Erro Webhook crítico:", err);
    if (err instanceof Error) {
      console.error("Stack trace:", err.stack);
    }
    return NextResponse.json({ message: "Erro interno" }, { status: 500 });
  }
}