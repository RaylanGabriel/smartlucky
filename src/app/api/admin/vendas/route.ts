import { NextResponse } from "next/server";
import { requestAutenticada } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requestAutenticada(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin()
    .from("rifas")
    .select("id, numero_escolhido, nome, email, telefone, status, payment_id, created_at")
    .order("numero_escolhido", { ascending: true });

  if (error) {
    console.error("[admin/vendas]", error.message);
    return NextResponse.json({ error: "Erro ao buscar vendas" }, { status: 500 });
  }

  return NextResponse.json({ vendas: data }, { headers: { "Cache-Control": "no-store" } });
}
