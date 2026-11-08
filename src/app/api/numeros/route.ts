import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { FOLGA_LIBERACAO_MINUTOS, RESERVA_MINUTOS } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Retorna apenas os números ocupados (sem nenhum dado pessoal).
 * Substitui a leitura direta da tabela "rifas" pelo navegador.
 */
export async function GET() {
  try {
    const corte = new Date(
      Date.now() - (RESERVA_MINUTOS + FOLGA_LIBERACAO_MINUTOS) * 60 * 1000
    ).toISOString();

    // Pagos + pendentes ainda dentro do prazo. Pendentes vencidos aparecem
    // como livres e são removidos de fato na próxima compra desses números.
    const { data, error } = await supabaseAdmin()
      .from("rifas")
      .select("numero_escolhido")
      .or(`status.eq.pago,and(status.eq.pendente,created_at.gte."${corte}")`);

    if (error) throw error;

    return NextResponse.json(
      { ocupados: data.map((r) => Number(r.numero_escolhido)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[numeros] Erro:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Erro ao carregar números" }, { status: 500 });
  }
}
