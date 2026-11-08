import "server-only";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";

/**
 * IP do cliente. Na Vercel, x-real-ip / x-forwarded-for são definidos pela
 * própria plataforma (valores enviados pelo cliente são sobrescritos).
 */
export function ipDaRequest(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "desconhecido"
  );
}

/** Hash do IP com segredo do servidor: permite comparar sem guardar o IP (LGPD). */
export function hashIp(ip: string): string {
  const segredo = process.env.ADMIN_SESSION_SECRET ?? "";
  return createHmac("sha256", segredo).update(`ip:${ip}`).digest("base64url").slice(0, 32);
}

/**
 * Conta uma requisição na janela e diz se ainda está dentro do limite.
 * Se o banco falhar, libera (fail-open) para não derrubar o site.
 */
export async function dentroDoLimite(
  chave: string,
  janelaSegundos: number,
  maximo: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("rate_limit_hit", {
    p_key: chave,
    p_window_seconds: janelaSegundos,
    p_max: maximo,
  });
  if (error) {
    console.error("[rate-limit] Erro:", error.message);
    return true;
  }
  return data === true;
}

export function respostaLimite(mensagem: string, retryAfterSeg: number) {
  return NextResponse.json(
    { error: mensagem },
    { status: 429, headers: { "Retry-After": String(retryAfterSeg) } }
  );
}
