import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  criarPagamentoPix,
  cancelarPagamentoMP,
  liberarReservasExpiradas,
} from "@/lib/payments";
import { LIMITE_SELECAO, TOTAL_NUMEROS, VALOR_UNITARIO } from "@/lib/config";

type Entrada = {
  nome: string;
  mail: string;
  telefone: string;
  numeros: number[];
};

function validar(body: unknown): Entrada | string {
  if (!body || typeof body !== "object") return "Dados inválidos";
  const { nome, mail, telefone, numeros } = body as Record<string, unknown>;

  if (typeof nome !== "string") return "Nome inválido";
  const nomeLimpo = nome.trim().replace(/\s+/g, " ");
  if (nomeLimpo.length < 3 || nomeLimpo.length > 100 || !/^[a-zA-ZÀ-ÿ ]+$/.test(nomeLimpo)) {
    return "Nome inválido";
  }

  if (typeof mail !== "string") return "E-mail inválido";
  const mailLimpo = mail.trim().toLowerCase();
  if (mailLimpo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailLimpo)) {
    return "E-mail inválido";
  }

  if (typeof telefone !== "string") return "Telefone inválido";
  const telDigitos = telefone.replace(/\D/g, "");
  if (telDigitos.length < 10 || telDigitos.length > 11) return "Telefone inválido";

  if (!Array.isArray(numeros) || numeros.length === 0) {
    return "Selecione ao menos um número";
  }
  if (numeros.length > LIMITE_SELECAO) {
    return `Máximo de ${LIMITE_SELECAO} números por compra`;
  }
  if (!numeros.every((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_NUMEROS)) {
    return "Número inválido na seleção";
  }
  if (new Set(numeros).size !== numeros.length) return "Números repetidos";

  return {
    nome: nomeLimpo,
    mail: mailLimpo,
    telefone: telDigitos,
    numeros: [...(numeros as number[])].sort((a, b) => a - b),
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const entrada = validar(body);
  if (typeof entrada === "string") {
    return NextResponse.json({ error: entrada }, { status: 400 });
  }
  const { nome, mail, telefone, numeros } = entrada;

  try {
    const db = supabaseAdmin();

    // Libera reservas vencidas desses números antes de checar disponibilidade.
    await liberarReservasExpiradas({ numeros, limite: LIMITE_SELECAO });

    const { data: ocupados, error: ocupadosError } = await db
      .from("rifas")
      .select("numero_escolhido")
      .in("numero_escolhido", numeros);

    if (ocupadosError) throw ocupadosError;
    if (ocupados.length > 0) {
      return NextResponse.json(
        {
          error: "Alguns números acabaram de ser reservados por outra pessoa.",
          ocupados: ocupados.map((o) => o.numero_escolhido),
        },
        { status: 409 }
      );
    }

    // 1. Reserva os números ANTES de gerar o PIX. A constraint UNIQUE em
    //    numero_escolhido impede venda dupla em requisições simultâneas.
    const reservaId = crypto.randomUUID();
    const idTemporario = `tmp-${reservaId}`;

    const { error: insertError } = await db.from("rifas").insert(
      numeros.map((numero) => ({
        numero_escolhido: numero,
        status: "pendente",
        nome,
        email: mail,
        telefone,
        payment_id: idTemporario,
      }))
    );

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Alguns números acabaram de ser reservados por outra pessoa." },
          { status: 409 }
        );
      }
      throw insertError;
    }

    // 2. Gera o PIX com o valor calculado no servidor.
    const valor = numeros.length * VALOR_UNITARIO;
    const pagamento = await criarPagamentoPix({
      valor,
      numeros,
      email: mail,
      nome,
      reservaId,
    });

    if (!pagamento.ok) {
      await db.from("rifas").delete().eq("payment_id", idTemporario);
      return NextResponse.json(
        { error: pagamento.erro },
        { status: pagamento.httpStatus }
      );
    }

    const paymentId = String(pagamento.mp.id);

    // 3. Vincula as reservas ao pagamento real.
    const { error: vinculoError } = await db
      .from("rifas")
      .update({ payment_id: paymentId })
      .eq("payment_id", idTemporario);

    if (vinculoError) {
      console.error("[create-payment] Falha ao vincular reserva:", vinculoError.message);
      await cancelarPagamentoMP(paymentId);
      await db.from("rifas").delete().eq("payment_id", idTemporario);
      throw vinculoError;
    }

    const tx = pagamento.mp.point_of_interaction?.transaction_data;
    return NextResponse.json({
      id: paymentId,
      qr_code: tx?.qr_code ?? null,
      qr_code_base64: tx?.qr_code_base64 ?? null,
      expira_em: pagamento.mp.date_of_expiration ?? null,
    });
  } catch (error) {
    console.error(
      "[create-payment] Erro:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Erro interno no servidor" },
      { status: 500 }
    );
  }
}
