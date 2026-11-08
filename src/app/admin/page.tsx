"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { styles } from "@/app/styles";
import { Trash2, ExternalLink, LogOut, CheckCircle } from "lucide-react";

interface Venda {
  id: number | string;
  numero_escolhido: number;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  status: string | null;
  payment_id: string | null;
}

const INTERVALO_ATUALIZACAO_MS = 15_000;

export default function AdminPage() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const router = useRouter();

  /** Busca vendas pela API protegida. 401 = sessão inválida → login. */
  const buscarVendas = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vendas", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { vendas: Venda[] };
      setVendas(data.vendas);
    } catch {
      // Falha de rede: tenta de novo no próximo ciclo.
    }
  }, [router]);

  useEffect(() => {
    buscarVendas();
    const intervalo = setInterval(buscarVendas, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(intervalo);
  }, [buscarVendas]);

  async function executarAcao(id: Venda["id"], acao: "excluir" | "vender") {
    const msg =
      acao === "excluir"
        ? "Liberar número e apagar reserva?"
        : "Confirmar pagamento manualmente?";

    if (!confirm(msg)) return;

    try {
      const res = await fetch("/api/admin/acoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: acao }),
      });

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }

      const result = await res.json().catch(() => ({}));

      if (res.ok && result.success) {
        if (acao === "excluir") {
          setVendas((prev) => prev.filter((v) => v.id !== id));
        } else {
          buscarVendas();
        }
      } else {
        alert("Erro: " + (result.error ?? "falha ao executar ação"));
      }
    } catch {
      alert("Erro ao conectar com o servidor.");
    }
  }

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.push("/admin/login");
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={`${styles.header.wrapper} flex justify-between items-center`}>
          <div>
            <h1 className={styles.header.title}>
              Painel <span className="text-[#8257E5]">Admin</span>
            </h1>
            <p className={styles.header.subtitle}>
              Gerencie as reservas da SmartLucky
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-all font-bold uppercase"
          >
            <LogOut size={16} /> Sair
          </button>
        </header>

        <div className="bg-[#121214] border border-[#29292E] rounded-xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#09090A] text-[#8257E5] uppercase text-[10px] font-black tracking-widest border-b border-[#29292E]">
              <tr>
                <th className="p-4">Nº</th>
                <th className="p-4">Cliente / Status</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#29292E]">
              {vendas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-10 text-center text-gray-500 italic">
                    Nenhuma reserva encontrada.
                  </td>
                </tr>
              ) : (
                vendas.map((venda) => (
                  <tr key={venda.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-4 font-black text-[#8257E5] text-lg">
                      #{String(venda.numero_escolhido).padStart(2, "0")}
                    </td>

                    <td className="p-4">
                      <div className="font-bold text-white uppercase">
                        {venda.nome ?? "—"}
                      </div>
                      <div className="text-gray-500 text-xs">{venda.email}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">
                          {venda.telefone ?? ""}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 rounded border ${
                            venda.status === "pago"
                              ? "border-green-500 text-green-500"
                              : "border-yellow-500 text-yellow-500"
                          }`}
                        >
                          {venda.status?.toUpperCase() || "PENDENTE"}
                        </span>
                      </div>
                    </td>

                    <td className="p-4 text-right space-x-2">
                      {venda.telefone && (
                        <a
                          href={`https://wa.me/55${venda.telefone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block p-2 text-green-500 hover:bg-green-500/10 rounded-lg"
                          title="WhatsApp"
                        >
                          <ExternalLink size={18} />
                        </a>
                      )}

                      {venda.status !== "pago" && (
                        <button
                          onClick={() => executarAcao(venda.id, "vender")}
                          className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg"
                          title="Confirmar Pagamento"
                        >
                          <CheckCircle size={18} />
                        </button>
                      )}

                      <button
                        onClick={() => executarAcao(venda.id, "excluir")}
                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                        title="Excluir"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
