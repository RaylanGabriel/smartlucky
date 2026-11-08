import { NextResponse } from "next/server";
import { requestAutenticada } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ACOES = ["excluir", "vender"] as const;
type Acao = (typeof ACOES)[number];

export async function POST(request: Request) {
  if (!requestAutenticada(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action as Acao;
  const id = body?.id;

  if (!ACOES.includes(action)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }
  if (
    !(typeof id === "number" && Number.isInteger(id)) &&
    !(typeof id === "string" && /^[\w-]{1,64}$/.test(id))
  ) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const { error } =
      action === "excluir"
        ? await db.from("rifas").delete().eq("id", id)
        : await db.from("rifas").update({ status: "pago" }).eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/acoes]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Erro ao executar ação" }, { status: 500 });
  }
}
