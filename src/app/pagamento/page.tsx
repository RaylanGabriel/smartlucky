"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Clock, Copy } from "lucide-react";
import Script from "next/script";

/* ===========================
   Timer
=========================== */
export function Timer({ createdAt }: { createdAt: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const router = useRouter();

  useEffect(() => {
    const calculateTime = (): boolean => {
      const createdTime = new Date(createdAt.replace(" ", "T")).getTime();
      const expirationTime = createdTime + 15 * 60 * 1000;
      const now = Date.now();
      const difference = expirationTime - now;

      if (difference <= 0) {
        alert("Sua reserva expirou, o número não foi reservado!");
        router.push("/");
        return false;
      }

      const minutes = Math.floor((difference / 60000) % 60);
      const seconds = Math.floor((difference / 1000) % 60);

      setTimeLeft(
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      );
      return true;
    };

    const active = calculateTime();
    if (!active) return;

    const interval = setInterval(() => {
      const stillActive = calculateTime();
      if (!stillActive) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [createdAt, router]);

  return (
    <div className="w-full text-center p-3 bg-[#17171B] rounded-xl border border-red-500/20 mb-4">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
        Sua reserva expira em
      </p>
      <span className="text-2xl font-mono text-red-500 font-bold">
        {timeLeft}
      </span>
    </div>
  );
}

/* ===========================
   Conteúdo principal
=========================== */
function PagamentoContent() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("id");
  const qrCode = searchParams.get("code");

  const [status, setStatus] = useState<"pendente" | "approved">("pendente");
  const [reserva, setReserva] = useState<{ created_at: string } | null>(null);

  /* ===========================
     Checa status no Supabase e polling do servidor
  =========================== */
  useEffect(() => {
    if (!paymentId) return;

    const checkStatus = async () => {
      try {
        // Primeiro, checa com o novo endpoint que processa pagamentos
        // Este endpoint tenta processar o pagamento se estiver pendente
        const apiResponse = await fetch(
          `/api/webhooks/check-payment?payment_id=${paymentId}`
        );
        if (apiResponse.ok) {
          const apiData = await apiResponse.json();
          if (apiData.status === "approved") {
            setStatus("approved");
            return;
          }
        }

        // Fallback: checa direto no Supabase
        const { data, error } = await supabase
          .from("rifas")
          .select("status, created_at")
          .eq("payment_id", paymentId);

        if (error) {
          console.error("Erro Supabase:", error.message);
          return;
        }

        if (data) {
          // Pode retornar um array de linhas (uma por número) ou um único objeto
          const first = Array.isArray(data) ? data[0] : data;
          setReserva(first as { created_at: string });
          if (first?.status === "approved" || first?.status === "pago") {
            setStatus("approved");
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error("Erro crítico:", err.message);
        } else {
          console.error("Erro crítico desconhecido");
        }
      }
    };

    checkStatus();

    // Poll a cada 5 segundos para processar pagamentos pendentes
    const pollingInterval = setInterval(checkStatus, 5000);

    const channel = supabase
      .channel("check-pagamento")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rifas",
          filter: `payment_id=eq.${paymentId}`,
        },
        (payload) => {
          const newStatus = payload.new.status as string;
          if (newStatus === "approved" || newStatus === "pago") {
            setStatus("approved");
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollingInterval);
      supabase.removeChannel(channel);
    };
  }, [paymentId]);

  /* ===========================
     Pagamento aprovado
  =========================== */
  if (status === "approved") {
    return (
      <main className="min-h-screen bg-[#09090A] flex items-center justify-center p-4">
        <div className="bg-[#121214] p-8 rounded-2xl border border-green-500/20 text-center max-w-md w-full">
          <CheckCircle2 size={64} className="text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">
            Pagamento Confirmado!
          </h1>
          <p className="text-gray-400 mb-6">
            Seus números foram reservados com sucesso. Boa sorte!
          </p>
          <button
            onClick={() => (window.location.href = "/")}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg transition-colors"
          >
            VOLTAR PARA O INÍCIO
          </button>
        </div>
      </main>
    );
  }

  /* ===========================
     Tela de pagamento
  =========================== */
  return (
    <>
      <Script
        src="https://sdk.mercadopago.com/js/v2"
        strategy="afterInteractive"
        onLoad={() => {
          if (window.MercadoPago) {
            new window.MercadoPago(
              process.env.NEXT_PUBLIC_MP_PUBLIC_KEY!,
              { locale: "pt-BR" }
            );
          }
        }}
      />

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
            {reserva?.created_at && (
              <Timer createdAt={reserva.created_at} />
            )}

            {qrCode ? (
              <div className="bg-white p-2 rounded-xl">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
                    qrCode
                  )}&size=250x250`}
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
                  onClick={() => {
                    if (qrCode) {
                      navigator.clipboard.writeText(qrCode);
                      alert("Código copiado!");
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8257E5] hover:text-white transition-colors"
                >
                  <Copy size={20} />
                </button>
              </div>
            </div>

            <div className="w-full bg-[#17171B] border border-white/5 rounded-xl p-4 flex items-center gap-3">
              <Clock size={20} className="text-[#8257E5]" />
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Realize o pagamento. Após 15 minutos, sua reserva será cancelada
                e os números voltarão a ficar disponíveis.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}


export default function PagamentoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#09090A] flex items-center justify-center">
          <div className="text-[#8257E5] animate-pulse font-mono">
            CARREGANDO...
          </div>
        </div>
      }
    >
      <PagamentoContent />
    </Suspense>
  );
}
