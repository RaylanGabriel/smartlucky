import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "smartlucky_admin";
const DURACAO_SESSAO_SEG = 8 * 60 * 60; // 8 horas

function segredo(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET ausente ou curto (mínimo 32 caracteres)");
  }
  return s;
}

function assinar(payload: string): string {
  return createHmac("sha256", segredo()).update(payload).digest("base64url");
}

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // Compara sempre com o mesmo tamanho para não vazar informação por tempo.
  const max = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(max);
  const pb = Buffer.alloc(max);
  ba.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

export function credenciaisValidas(usuario: unknown, senha: unknown): boolean {
  const u = process.env.ADMIN_USUARIO;
  const s = process.env.ADMIN_SENHA;
  if (!u || !s) {
    console.error("[admin] ADMIN_USUARIO/ADMIN_SENHA não configurados");
    return false;
  }
  if (typeof usuario !== "string" || typeof senha !== "string") return false;
  // Avalia as duas comparações sempre (sem curto-circuito).
  const okUsuario = iguais(usuario, u);
  const okSenha = iguais(senha, s);
  return okUsuario && okSenha;
}

export function criarTokenSessao(): { token: string; maxAge: number } {
  const expira = Math.floor(Date.now() / 1000) + DURACAO_SESSAO_SEG;
  const payload = `admin.${expira}`;
  return { token: `${payload}.${assinar(payload)}`, maxAge: DURACAO_SESSAO_SEG };
}

export function sessaoValida(token: string | undefined | null): boolean {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  const [sujeito, expira, assinatura] = partes;
  const payload = `${sujeito}.${expira}`;
  try {
    if (!iguais(assinatura, assinar(payload))) return false;
  } catch {
    return false;
  }
  return Number(expira) > Math.floor(Date.now() / 1000);
}

/** Lê o cookie de sessão de uma Request e diz se o admin está autenticado. */
export function requestAutenticada(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  return sessaoValida(token ? decodeURIComponent(token) : null);
}
