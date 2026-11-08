import { NextResponse } from "next/server";
import { ADMIN_COOKIE, credenciaisValidas, criarTokenSessao } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!credenciaisValidas(body?.usuario, body?.senha)) {
    // Atraso simples para dificultar força bruta.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  try {
    const { token, maxAge } = criarTokenSessao();
    const res = NextResponse.json({ success: true });
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge,
    });
    return res;
  } catch (err) {
    console.error("[admin/login]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Login indisponível" }, { status: 500 });
  }
}
