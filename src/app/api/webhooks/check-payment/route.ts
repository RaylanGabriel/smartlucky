import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { confirmarPagamento, paymentIdValido } from "@/lib/payments";
import { RESERVA_MINUTOS } from "@/lib/config";

export const dynamic = "force-dynamic";

function parseData(valor: unknown): Date | null {
  if (!valor) return null;
  const s = String(valor);
  // Coluna "timestamp" sem fuso vem sem sufixo: tratamos como UTC.
  const comFuso = /([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(comFuso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Usado pela página /pagamento (polling). Não expõe dados pessoais:
 * devolve apenas status, QR code e prazo de expiração.
 */
export async function GET(request: Request) {
  const paymentId = new URL(request.url).searchParams.get("payment_id");
  if (!paymentIdValido(paymentId)) {
    return NextResponse.json({ error: "payment_id inválido" }, { status: 400 });
  }

  try {
    const { data: reservas, error } = await supabaseAdmin()
      .from("rifas")
      .select("status, created_at")
      .eq("payment_id", paymentId);

    if (error) throw error;

    if (reservas.length === 0) {
      return NextResponse.json({ payment_id: paymentId, status: "expired" });
    }

    if (reservas.every((r) => r.status === "pago")) {
      return NextResponse.json({ payment_id: paymentId, status: "approved" });
    }

    const resultado = await confirmarPagamento(paymentId);
    const criadoEm = parseData(reservas[0].created_at);
    const expiraEm =
      parseData(resultado.status !== "erro" ? resultado.mp?.date_of_expiration : null) ??
      (criadoEm ? new Date(criadoEm.getTime() + RESERVA_MINUTOS * 60 * 1000) : null);

    switch (resultado.status) {
      case "aprovado":
        return NextResponse.json({ payment_id: paymentId, status: "approved" });
      case "cancelado":
      case "nao_encontrado":
        return NextResponse.json({ payment_id: paymentId, status: "expired" });
      case "valor_divergente":
        return NextResponse.json({
          payment_id: paymentId,
          status: "error",
          message: "Houve um problema com o valor do pagamento. Entre em contato.",
        });
      case "pendente": {
        const tx = resultado.mp.point_of_interaction?.transaction_data;
        return NextResponse.json({
          payment_id: paymentId,
          status: "pending",
          qr_code: tx?.qr_code ?? null,
          qr_code_base64: tx?.qr_code_base64 ?? null,
          expira_em: expiraEm?.toISOString() ?? null,
        });
      }
      default:
        // Falha temporária (MP fora do ar etc.): o front tenta de novo.
        return NextResponse.json({
          payment_id: paymentId,
          status: "pending",
          expira_em: expiraEm?.toISOString() ?? null,
        });
    }
  } catch (err) {
    console.error("[check-payment] Erro:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Erro ao processar requisição" }, { status: 500 });
  }
}
