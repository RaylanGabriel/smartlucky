import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { enviarEmailConfirmacao } from "./email";
import {
  FOLGA_LIBERACAO_MINUTOS,
  RESERVA_MINUTOS,
  VALOR_UNITARIO,
} from "./config";

const MP_API = "https://api.mercadopago.com/v1/payments";

export type PagamentoMP = {
  id: number;
  status: string;
  transaction_amount: number;
  currency_id?: string;
  external_reference?: string;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string };
  };
};

export type ResultadoConfirmacao =
  | { status: "aprovado"; mp: PagamentoMP | null }
  | { status: "pendente"; mp: PagamentoMP }
  | { status: "cancelado"; mp: PagamentoMP }
  | { status: "valor_divergente"; mp: PagamentoMP }
  | { status: "nao_encontrado"; mp: PagamentoMP | null }
  | { status: "erro" };

const STATUS_FALHA_MP = ["rejected", "cancelled", "refunded", "charged_back"];

function mpToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado");
  return token;
}

/** IDs de pagamento do Mercado Pago são numéricos. */
export function paymentIdValido(id: unknown): id is string {
  return typeof id === "string" && /^\d{1,20}$/.test(id);
}

/** Formata a data no padrão aceito pelo MP (yyyy-MM-ddTHH:mm:ss.SSS-03:00). */
function dataMP(data: Date): string {
  const brasilia = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return brasilia.toISOString().replace("Z", "-03:00");
}

export async function buscarPagamentoMP(
  paymentId: string
): Promise<PagamentoMP | null> {
  const res = await fetch(`${MP_API}/${paymentId}`, {
    headers: { Authorization: `Bearer ${mpToken()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[mp] GET pagamento ${paymentId} -> ${res.status}`);
    return null;
  }
  return (await res.json()) as PagamentoMP;
}

export async function criarPagamentoPix(params: {
  valor: number;
  numeros: number[];
  email: string;
  nome: string;
  reservaId: string;
}): Promise<{ ok: true; mp: PagamentoMP } | { ok: false; erro: string; httpStatus: number }> {
  const notificationUrl =
    process.env.MP_NOTIFICATION_URL ||
    "https://smartlucky.vercel.app/api/webhooks/mercadopago";

  const expiraEm = new Date(Date.now() + RESERVA_MINUTOS * 60 * 1000);

  const res = await fetch(MP_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mpToken()}`,
      "X-Idempotency-Key": params.reservaId,
    },
    body: JSON.stringify({
      transaction_amount: params.valor,
      description: `Rifa SmartLucky - Números: ${params.numeros.join(", ")}`,
      payment_method_id: "pix",
      external_reference: params.reservaId,
      notification_url: notificationUrl,
      date_of_expiration: dataMP(expiraEm),
      metadata: { numeros: params.numeros, reserva_id: params.reservaId },
      payer: { email: params.email, first_name: params.nome },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[mp] Erro ao criar pagamento:", res.status, data?.message);
    return {
      ok: false,
      erro: "Não foi possível gerar o PIX. Tente novamente.",
      httpStatus: 502,
    };
  }
  return { ok: true, mp: data as PagamentoMP };
}

export async function cancelarPagamentoMP(paymentId: string): Promise<boolean> {
  const res = await fetch(`${MP_API}/${paymentId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mpToken()}`,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!res.ok) {
    console.error(`[mp] Falha ao cancelar ${paymentId} -> ${res.status}`);
  }
  return res.ok;
}

async function marcarFila(paymentId: string, status: string) {
  const { error } = await supabaseAdmin()
    .from("webhook_queue")
    .update({ status })
    .eq("payment_id", paymentId);
  if (error) console.error("[fila] Erro ao atualizar:", error.message);
}

/**
 * Consulta o pagamento no Mercado Pago e, se aprovado, marca as reservas como
 * pagas. É idempotente e seguro contra chamadas concorrentes: só a chamada que
 * de fato muda as linhas de "pendente" para "pago" envia o e-mail.
 */
export async function confirmarPagamento(
  paymentId: string,
  mpJaBuscado?: PagamentoMP | null
): Promise<ResultadoConfirmacao> {
  const db = supabaseAdmin();

  const { data: reservas, error } = await db
    .from("rifas")
    .select("numero_escolhido, status")
    .eq("payment_id", paymentId);

  if (error) {
    console.error("[confirmar] Erro ao buscar reservas:", error.message);
    return { status: "erro" };
  }

  if (reservas.length > 0 && reservas.every((r) => r.status === "pago")) {
    await marcarFila(paymentId, "processed");
    return { status: "aprovado", mp: mpJaBuscado ?? null };
  }

  const mp = mpJaBuscado ?? (await buscarPagamentoMP(paymentId));
  if (!mp) return { status: "erro" };

  if (reservas.length === 0) {
    if (mp.status === "approved") {
      // Pagamento aprovado sem reserva (ex.: excluída no admin). Precisa de ação manual.
      console.error(
        `[confirmar] ATENÇÃO: pagamento ${paymentId} aprovado sem reservas no banco`
      );
      await marcarFila(paymentId, "sem_reserva");
    }
    return { status: "nao_encontrado", mp };
  }

  if (STATUS_FALHA_MP.includes(mp.status)) {
    await db
      .from("rifas")
      .delete()
      .eq("payment_id", paymentId)
      .eq("status", "pendente");
    await marcarFila(paymentId, "processed");
    return { status: "cancelado", mp };
  }

  if (mp.status !== "approved") {
    return { status: "pendente", mp };
  }

  // Confere se o valor pago cobre todos os números reservados.
  const esperadoCentavos = Math.round(reservas.length * VALOR_UNITARIO * 100);
  const pagoCentavos = Math.round(Number(mp.transaction_amount) * 100);
  if (pagoCentavos < esperadoCentavos || (mp.currency_id && mp.currency_id !== "BRL")) {
    console.error(
      `[confirmar] Valor divergente em ${paymentId}: pago ${pagoCentavos}, esperado ${esperadoCentavos}`
    );
    await marcarFila(paymentId, "valor_divergente");
    return { status: "valor_divergente", mp };
  }

  // Update condicional: só linhas ainda pendentes. Garante e-mail único.
  const { data: atualizadas, error: updateError } = await db
    .from("rifas")
    .update({ status: "pago", payment_info: mp })
    .eq("payment_id", paymentId)
    .eq("status", "pendente")
    .select("numero_escolhido, email");

  if (updateError) {
    console.error("[confirmar] Erro no update:", updateError.message);
    return { status: "erro" };
  }

  if (atualizadas.length > 0) {
    const email = atualizadas[0].email as string | null;
    if (email) {
      await enviarEmailConfirmacao(
        email,
        atualizadas.map((r) => r.numero_escolhido),
        paymentId
      );
    }
  }

  await marcarFila(paymentId, "processed");
  return { status: "aprovado", mp };
}

/**
 * Libera reservas pendentes que passaram do prazo. Antes de liberar, confere no
 * Mercado Pago: se foi pago, confirma; se ainda está pendente, cancela o PIX
 * para que ninguém consiga pagar por um número que voltou a ficar disponível.
 */
export async function liberarReservasExpiradas(opcoes?: {
  numeros?: number[];
  limite?: number;
}): Promise<number> {
  const db = supabaseAdmin();
  const corte = new Date(
    Date.now() - (RESERVA_MINUTOS + FOLGA_LIBERACAO_MINUTOS) * 60 * 1000
  ).toISOString();

  let query = db
    .from("rifas")
    .select("payment_id")
    .eq("status", "pendente")
    .lt("created_at", corte)
    .limit(200);
  if (opcoes?.numeros?.length) {
    query = query.in("numero_escolhido", opcoes.numeros);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[expiradas] Erro ao buscar:", error.message);
    return 0;
  }

  const ids = [...new Set(data.map((r) => r.payment_id as string | null))].slice(
    0,
    opcoes?.limite ?? 10
  );

  let liberadas = 0;
  for (const id of ids) {
    try {
      if (!id || !paymentIdValido(id)) {
        // Reserva sem pagamento válido (falha na criação do PIX).
        const del = id
          ? db.from("rifas").delete().eq("payment_id", id)
          : db.from("rifas").delete().is("payment_id", null);
        await del.eq("status", "pendente").lt("created_at", corte);
        liberadas++;
        continue;
      }

      const resultado = await confirmarPagamento(id);
      if (resultado.status === "pendente") {
        if (await cancelarPagamentoMP(id)) {
          await db
            .from("rifas")
            .delete()
            .eq("payment_id", id)
            .eq("status", "pendente");
          liberadas++;
        }
      } else if (resultado.status === "cancelado") {
        liberadas++;
      }
    } catch (err) {
      console.error(
        `[expiradas] Erro em ${id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return liberadas;
}
