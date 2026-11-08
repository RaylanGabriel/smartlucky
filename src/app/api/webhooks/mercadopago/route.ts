import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { confirmarPagamento, paymentIdValido } from "@/lib/payments";

type WebhookMP = {
  id?: string | number;
  type?: string;
  topic?: string;
  data?: { id?: string | number };
};

/**
 * Valida o header x-signature do Mercado Pago.
 * Só é exigido quando MP_WEBHOOK_SECRET está configurado (chave secreta
 * gerada em "Suas integrações > Webhooks" no painel do MP).
 */
function assinaturaValida(request: Request, dataId: string): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  if (!xSignature) return false;

  const partes = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k?.trim(), v.join("=").trim()];
    })
  );
  const ts = partes["ts"];
  const v1 = partes["v1"];
  if (!ts || !v1) return false;

  let manifest = `id:${dataId.toLowerCase()};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const esperado = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  let body: WebhookMP = {};
  try {
    const texto = await request.text();
    if (texto.trim()) body = JSON.parse(texto);
  } catch {
    // Corpo inválido: tenta pelos parâmetros da URL (formato IPN antigo).
  }

  const tipo =
    body.type ?? body.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (tipo && tipo !== "payment") {
    return NextResponse.json({ message: "Ignorado" }, { status: 200 });
  }

  const dataIdQuery = url.searchParams.get("data.id");
  const paymentId = String(
    body.data?.id ?? dataIdQuery ?? url.searchParams.get("id") ?? body.id ?? ""
  );
  if (!paymentIdValido(paymentId)) {
    return NextResponse.json({ message: "Ok" }, { status: 200 });
  }

  if (!assinaturaValida(request, dataIdQuery ?? paymentId)) {
    console.warn(`[webhook] Assinatura inválida para ${paymentId}`);
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  // Registra na fila sem sobrescrever um item já processado
  // (o MP envia várias notificações para o mesmo pagamento).
  const { error: filaError } = await supabaseAdmin()
    .from("webhook_queue")
    .upsert(
      {
        payment_id: paymentId,
        status: "pending",
        attempts: 0,
        created_at: new Date().toISOString(),
      },
      { onConflict: "payment_id", ignoreDuplicates: true }
    );
  if (filaError) console.error("[webhook] Erro na fila:", filaError.message);

  // Processa na hora. Se falhar, o item continua na fila para o process-pending.
  // Os dados sempre são buscados direto na API do MP, então uma notificação
  // falsa não consegue aprovar nada.
  try {
    const resultado = await confirmarPagamento(paymentId);
    console.log(`[webhook] ${paymentId}: ${resultado.status}`);
  } catch (err) {
    console.error("[webhook] Erro ao processar:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ message: "Ok" }, { status: 200 });
}
