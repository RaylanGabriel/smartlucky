import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { confirmarPagamento, liberarReservasExpiradas } from "@/lib/payments";

export const dynamic = "force-dynamic";

const MAX_TENTATIVAS = 5;

/**
 * Reprocessa webhooks que falharam e libera reservas vencidas.
 * Protegido por CRON_SECRET: chame com o header
 *   Authorization: Bearer <CRON_SECRET>
 * (o Vercel Cron envia esse header automaticamente quando CRON_SECRET existe).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const { data: fila, error } = await db
      .from("webhook_queue")
      .select("payment_id, attempts")
      .eq("status", "pending")
      .lt("attempts", MAX_TENTATIVAS)
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) throw error;

    const resultados: Record<string, string> = {};
    for (const item of fila) {
      await db
        .from("webhook_queue")
        .update({ attempts: (item.attempts ?? 0) + 1 })
        .eq("payment_id", item.payment_id);

      try {
        const r = await confirmarPagamento(item.payment_id);
        resultados[item.payment_id] = r.status;
      } catch (err) {
        resultados[item.payment_id] = "erro";
        console.error(
          `[process-pending] ${item.payment_id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    const liberadas = await liberarReservasExpiradas({ limite: 20 });

    return NextResponse.json({ processados: resultados, reservas_liberadas: liberadas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[process-pending] Erro geral:", msg);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
