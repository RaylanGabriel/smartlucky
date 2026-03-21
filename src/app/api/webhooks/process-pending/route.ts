import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Importar função de enviar email do webhook
async function enviarEmailBrevo(
  email: string,
  numeros: unknown[],
  paymentId: string
) {
  try {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    if (!BREVO_API_KEY) return;

    await fetch("https://api.brevo.com/v3/smtp/email", {
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
    });
  } catch (err) {
    console.error("Erro ao enviar email:", err);
  }
}

export async function GET(request: Request) {
  try {
    console.log("⏰ [CRON] Iniciando processamento de fila de webhooks");

    // ✅ BUSCAR PENDENTES
    const { data: pendingQueue, error: queueError } = await supabase
      .from("webhook_queue")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", 5) // Max 5 tentativas
      .order("created_at", { ascending: true })
      .limit(10); // Processar até 10 por vez

    if (queueError) {
      console.error("❌ Erro ao buscar fila:", queueError);
      return NextResponse.json({ error: queueError.message }, { status: 500 });
    }

    if (!pendingQueue || pendingQueue.length === 0) {
      console.log("ℹ️ Nenhum pagamento pendente para processar");
      return NextResponse.json({ processed: 0 }, { status: 200 });
    }

    console.log(`📦 Processando ${pendingQueue.length} webhooks pendentes`);

    let processed = 0;
    let successful = 0;

    // ✅ PROCESSAR CADA ITEM
    for (const queueItem of pendingQueue) {
      processed++;
      const paymentid = queueItem.payment_id;

      console.log(`[${processed}/${pendingQueue.length}] Payment ID: ${paymentid}`);

      try {
        // INCREMENTAR TENTATIVA
        await supabase
          .from("webhook_queue")
          .update({ attempts: (queueItem.attempts || 0) + 1 })
          .eq("payment_id", paymentid);

        // ✅ CONSULTAR MP
        console.log(`  ⏳ Consultando Mercado Pago...`);
        const response = await fetch(
          `https://api.mercadopago.com/v1/payments/${paymentid}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
            },
          }
        );

        if (!response.ok) {
          console.error(`  ❌ MP retornou ${response.status}`);
          continue;
        }

        const paymentData = await response.json();
        console.log(`  📊 Status: ${paymentData.status}`);

        // ✅ VERIFICAR STATUS
        if (paymentData.status !== "approved") {
          console.log(`  ⏸️ Não aprovado. Aguardando...`);
          continue;
        }

        // ✅ ATUALIZAR RIFAS
        console.log(`  ✅ Atualizando banco...`);
        const { data: updatedRifas, error: updateError } = await supabase
          .from("rifas")
          .update({
            status: "pago",
            payment_info: paymentData,
          })
          .eq("payment_id", paymentid)
          .select("email, numero_escolhido");

        if (updateError) {
          console.error(`  ❌ Erro no update:`, updateError.message);
          continue;
        }

        console.log(
          `  ✅ ${updatedRifas?.length ?? 0} linhas atualizadas`
        );

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

          console.log(`  📧 Enviando email para ${email}...`);
          await enviarEmailBrevo(email, numerosExtraidos, paymentid);
        }

        // ✅ MARCAR COMO PROCESSADO
        await supabase
          .from("webhook_queue")
          .update({ status: "processed" })
          .eq("payment_id", paymentid);

        successful++;
        console.log(`  ✅ [${paymentid}] SUCESSO!\n`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ❌ Erro crítico: ${errorMsg}`);
      }
    }

    const summary = `Processados: ${processed}, Sucesso: ${successful}`;
    console.log(`✅ [CRON] ${summary}`);

    return NextResponse.json(
      { processed, successful, message: summary },
      { status: 200 }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("❌ [CRON] Erro geral:", errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
