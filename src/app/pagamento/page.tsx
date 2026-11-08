"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Copy, XCircle } from "lucide-react";
import Timer from "@/components/Timer";
import { RESERVA_MINUTOS } from "@/lib/config";

type StatusTela = "pendente" | "approved" | "expired" | "error";

type RespostaCheck = {
  status: "pending" | "approved" | "expired" | "error";
  qr_code?: string | null;
  qr_code_base64?: string | null;
  expira_em?: string | null;
  message?: string;
};

const INTERVALO_MS = 5000;

function TelaFinal({
  tipo,
  titulo,
  texto,
}: {
  tipo: "ok" | "erro";
  titulo: string;
  texto: string;
}) {
  const Icone = tipo === "ok" ? CheckCircle2 : XCircle;
  const cor = tipo === "ok" ? "green" : "red";
  return (
    <main className="min-h-screen bg-[#09090A] flex items-center justify-center p-4">
      <div
        className={`bg-[#121214] p-8 rounded-2xl border text-center max-w-md w-full ${
          cor === "green" ? "border-green-500/20" : "border-red-500/20"
        }`}
      >
        <Icone
          size={64}
          className={`mx-auto mb-4 ${cor === "green" ? "text-green-500" : "text-red-500"}`}
        />
        <h1 className="text-2xl font-bold text-white mb-2">{titulo}</h1>
        <p className="text-gray-400 mb-6">{texto}</p>
        <button
          onClick={() => (window.location.href = "/")}
          className={`w-full text-white font-bold py-3 rounded-lg transition-colors ${
            cor === "green"
              ? "bg-green-500 hover:bg-green-600"
              : "bg-[#8257E5] hover:bg-[#9466FF]"
          }`}
        >
          VOLTAR PARA O INÍCIO
        </button>
      </div>
    </main>
  );
}

function PagamentoContent() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("id");

  const [status, setStatus] = useState<StatusTela>("pendente");
  const [mensagem, setMensagem] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [expiraEm, setExpiraEm] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!paymentId) return;

    let ativo = true;
    let intervalo: ReturnType<typeof setInterval> | null = null;
    // Para o polling um pouco depois do prazo da reserva.
    const limite = Date.now() + (RESERVA_MINUTOS + 5) * 60 * 1000;

    const parar = () => {
      if (intervalo) clearInterval(intervalo);
      intervalo = null;
    };

    const checar = async () => {
      if (Date.now() > limite) return parar();
      try {
        const res = await fetch(
          `/api/webhooks/check-payment?payment_id=${encodeURIComponent(paymentId)}`,
          { cache: "no-store" }
        );
        if (!res.ok || !ativo) return;
        const data = (await res.json()) as RespostaCheck;

        if (data.qr_code) setQrCode(data.qr_code);
        if (data.qr_code_base64) setQrBase64(data.qr_code_base64);
        if (data.expira_em) setExpiraEm(data.expira_em);

        if (data.status === "approved") {
          setStatus("approved");
          parar();
        } else if (data.status === "expired") {
          setStatus("expired");
          parar();
        } else if (data.status === "error") {
          setStatus("error");
          setMensagem(data.message ?? "");
          parar();
        }
      } catch (err) {
        console.error("Erro ao verificar status:", err);
      }
    };

    checar();
    intervalo = setInterval(checar, INTERVALO_MS);

    return () => {
      ativo = false;
      parar();
    };
  }, [paymentId]);

  const aoExpirar = useCallback(() => setStatus("expired"), []);

  if (!paymentId) {
    return (
      <TelaFinal tipo="erro" titulo="Pagamento não encontrado" texto="O link de pagamento é inválido." />
    );
  }

  if (status === "approved") {
    return (
      <TelaFinal
        tipo="ok"
        titulo="Pagamento Confirmado!"
        texto="Seus números foram reservados com sucesso. Você receberá a confirmação por e-mail. Boa sorte!"
      />
    );
  }

  if (status === "expired") {
    return (
      <TelaFinal
        tipo="erro"
        titulo="Reserva expirada"
        texto="O prazo para pagamento acabou e os números voltaram a ficar disponíveis."
      />
    );
  }

  if (status === "error") {
    return (
      <TelaFinal
        tipo="erro"
        titulo="Não foi possível confirmar"
        texto={mensagem || "Houve um problema com o pagamento. Entre em contato com o suporte."}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#09090A] text-white p-4 flex flex-col items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black italic uppercase tracking-tighter">
            QUASE <span className="text-[#8257E5]">LÁ!</span>
          </h1>
          <p className="text-gray-400 text-sm">
            Para garantir seus números, realize o pagamento via Pix.
          </p>
        </div>

        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 flex flex-col items-center gap-6">
          {expiraEm && <Timer expiraEm={expiraEm} onExpirar={aoExpirar} />}

          {qrBase64 ? (
            <div className="bg-white p-2 rounded-xl">
              {/* QR gerado pelo próprio Mercado Pago (data URI): nada é enviado a terceiros. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${qrBase64}`}
                alt="QR Code Pix"
                className="w-48 h-48"
              />
            </div>
          ) : (
            <div className="w-48 h-48 bg-white/5 animate-pulse rounded-xl flex items-center justify-center">
              <Clock className="text-gray-600" />
            </div>
          )}

          <div className="w-full space-y-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Copia e Cola
            </label>
            <div className="relative">
              <input
                readOnly
                value={qrCode || "Gerando código..."}
                className="w-full bg-[#09090A] border border-white/10 rounded-lg py-3 px-4 text-xs font-mono pr-12 text-gray-300"
              />
              <button
                onClick={async () => {
                  if (!qrCode) return;
                  try {
                    await navigator.clipboard.writeText(qrCode);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 2000);
                  } catch {
                    alert("Não foi possível copiar. Selecione o código manualmente.");
                  }
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8257E5] hover:text-white transition-colors"
                aria-label="Copiar código Pix"
              >
                {copiado ? <CheckCircle2 size={20} /> : <Copy size={20} />}
              </button>
            </div>
          </div>

          <div className="w-full bg-[#17171B] border border-white/5 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle size={20} className="text-[#8257E5] shrink-0" />
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Realize o pagamento. Após {RESERVA_MINUTOS} minutos, sua reserva será cancelada e os
              números voltarão a ficar disponíveis.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function PagamentoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#09090A] flex items-center justify-center">
          <div className="text-[#8257E5] animate-pulse font-mono">CARREGANDO...</div>
        </div>
      }
    >
      <PagamentoContent />
    </Suspense>
  );
}
