"use client";

import { useState, useEffect, useCallback } from "react";
import NumeroRifa, { StatusNumero } from "@/components/NumeroRifa";
import { styles } from "./styles";
import { User, Smartphone, CreditCard, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  LIMITE_SELECAO,
  NUMEROS_POR_PAGINA,
  TOTAL_NUMEROS,
  VALOR_UNITARIO,
} from "@/lib/config";

const STORAGE_KEY = "@rifa:selecionados";
const INTERVALO_ATUALIZACAO_MS = 10_000;

function lerSelecaoSalva(): number[] {
  try {
    const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(salvo)) return [];
    return salvo
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_NUMEROS)
      .slice(0, LIMITE_SELECAO);
  } catch {
    return [];
  }
}

export default function Home() {
  const router = useRouter();

  // ESTADOS PRINCIPAIS
  const [nome, setNome] = useState("");
  const [mail, setMail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [numerosOcupados, setNumerosOcupados] = useState<number[]>([]);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [carregado, setCarregado] = useState(false);
  const [estaProcessando, setEstaProcessando] = useState(false);

  const numerosPorPagina = NUMEROS_POR_PAGINA;
  const totalPaginas = Math.ceil(TOTAL_NUMEROS / numerosPorPagina);

  // CARREGA NÚMEROS OCUPADOS (via API, sem expor dados pessoais)
  const carregarReservas = useCallback(async () => {
    try {
      const res = await fetch("/api/numeros", { cache: "no-store" });
      if (!res.ok) return;
      const { ocupados } = (await res.json()) as { ocupados: number[] };
      setNumerosOcupados(ocupados);
      // Remove da seleção números que outra pessoa reservou nesse meio-tempo.
      setSelecionados((prev) => prev.filter((n) => !ocupados.includes(n)));
    } catch {
      // Falha de rede: tenta de novo no próximo ciclo.
    }
  }, []);

  useEffect(() => {
    carregarReservas();
    const intervalo = setInterval(carregarReservas, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(intervalo);
  }, [carregarReservas]);

  // LOCAL STORAGE
  useEffect(() => {
    setSelecionados(lerSelecaoSalva());
    setCarregado(true);
  }, []);

  useEffect(() => {
    if (!carregado) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selecionados));
    } catch {
      // Armazenamento indisponível (modo privado etc.).
    }
  }, [selecionados, carregado]);

  const gerenciarSelecao = (num: number) => {
    if (numerosOcupados.includes(num)) return;

    if (selecionados.includes(num)) {
      setSelecionados((prev) => prev.filter((n) => n !== num));
    } else {
      if (selecionados.length >= LIMITE_SELECAO) {
        alert(`Limite de ${LIMITE_SELECAO} números atingido.`);
        return;
      }
      setSelecionados((prev) => [...prev, num]);
    }
  };

  
  // FINALIZA PAGAMENTO (PIX)
  
  const handleFinalizar = async () => {
    setEstaProcessando(true);

    try {
      // O servidor valida os dados, reserva os números e calcula o valor.
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          telefone,
          mail,
          numeros: selecionados,
        }),
      });

      const checkout = await res.json().catch(() => ({}));

      if (res.status === 409) {
        alert(checkout.error ?? "Alguns números já foram reservados.");
        await carregarReservas();
        return;
      }
      if (!res.ok || !checkout.id) {
        alert(checkout.error ?? "Erro ao processar pagamento.");
        return;
      }

      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setSelecionados([]);

      router.push(`/pagamento?id=${encodeURIComponent(checkout.id)}`);
    } catch {
      alert("Erro de conexão ao processar pagamento.");
    } finally {
      setEstaProcessando(false);
    }
  };

  
 // NUMEROS DA PÁGINA
  
  const numerosDaPagina = Array.from(
    { length: numerosPorPagina },
    (_, i) => (paginaAtual - 1) * numerosPorPagina + i + 1,
  );

  return (
    <>
      {/* O SDK do Mercado Pago é carregado no layout. */}
      <main className={`${styles.main} overflow-x-hidden relative min-h-screen pb-20`}>
         {/* EFEITOS DE FUNDO */}
      <div className="absolute top-[-10%] left-[-10%] w-125 h-125 bg-[#8257E5] opacity-[0.15] blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[0%] right-[-10%] w-100 h-100 bg-[#4A90E2] opacity-[0.1] blur-[100px] rounded-full pointer-events-none"></div>

      <div className={`${styles.container} relative z-0 pt-0`}>
          {/* HEADER */}
          <header className={styles.header.wrapper}>
            <h1 className={styles.header.title}>
              <span className="text-[#8257E5]">Smart</span>Lucky
            </h1>
            <p className={styles.header.subtitle}>
              Escolha até {LIMITE_SELECAO} números
            </p>
          </header>
          {/* 2. CARD DE DESTAQUE DO PRÊMIO */}
          <section className="w-full max-w-2xl mx-auto mb-12 text-center px-4">
            <div className="bg-[#121214] border-2 border-[#8257E5]/30 rounded-2xl p-2 relative overflow-hidden shadow-[0_0_50px_-12px_rgba(130,87,229,0.3)]">
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#8257E5] blur-[100px] opacity-20"></div>

              <h2 className="text-2xl md:text-2xl font-black text-white italic uppercase tracking-tighter mb-2">
                Ganhe <span className="text-[#8257E5]">R$ 1.000,00</span>
              </h2>

              <p className="text-gray-400 text-sm md:text-base max-w-md mx-auto leading-relaxed">
                Garanta seu número por apenas{" "}
                <span className="text-white font-bold">
                  R$ {VALOR_UNITARIO.toFixed(2).replace(".", ",")}
                </span>{" "}
                e concorra ao prêmio direto no seu PIX!
              </p>
            </div>
          </section>

          {/* 3. NAVEGAÇÃO / PAGINAÇÃO */}
          <nav className={`${styles.pagination.wrapper} mb-6`}>
            <button
              className={`${styles.pagination.btn} ${styles.pagination.btnClaro}`}
              onClick={() => setPaginaAtual((p) => Math.max(p - 1, 1))}
              disabled={paginaAtual === 1}
            >
              Anterior
            </button>
            <span className="text-sm font-bold text-gray-400">
              Página {paginaAtual} de {totalPaginas}
            </span>
            <button
              className={`${styles.pagination.btn} ${styles.pagination.btnAzul}`}
              onClick={() =>
                setPaginaAtual((p) => Math.min(p + 1, totalPaginas))
              }
              disabled={paginaAtual === totalPaginas}
            >
              Próxima
            </button>
          </nav>

          {/* GRID */}
          <section className={styles.grid}>
            {numerosDaPagina.map((n) => {
              let status: StatusNumero = "disponivel";
              if (numerosOcupados.includes(n)) status = "vendido";
              else if (selecionados.includes(n)) status = "selecionado";

              return (
                <NumeroRifa
                  key={n}
                  numero={n}
                  status={status}
                  onClick={() => gerenciarSelecao(n)}
                />
              );
            })}
          </section>

          {/* FORMULÁRIO */}
          <footer className={styles.footer.wrapper}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="space-y-1">
                <label className={styles.footer.label}>NOME</label>
                <div className={styles.footer.inputWrapper}>
                  <User className={styles.footer.inputIcon} />
                  <input
                    type="text"
                    className={`${styles.footer.input} ${styles.footer.inputWithIcon}`}
                    value={nome}
                    onChange={(e) => {
                      const value = e.target.value.replace(
                        /[^a-zA-ZÀ-ÿ\s]/g,
                        "",
                      );
                      setNome(value);
                    }}
                    placeholder="Seu nome completo"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className={styles.footer.label}>TELEFONE</label>
                <div className={styles.footer.inputWrapper}>
                  <Smartphone className={styles.footer.inputIcon} />
                  <input
                    type="tel"
                    className={`${styles.footer.input} ${styles.footer.inputWithIcon}`}
                    value={telefone}
                    onChange={(e) => {
                      let value = e.target.value.replace(/\D/g, "");
                      if (value.length > 11) value = value.slice(0, 11);
                      value = value.replace(/^(\d{2})(\d)/g, "($1) $2");
                      value = value.replace(/(\d{5})(\d)/, "$1-$2");
                      setTelefone(value);
                    }}
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <label className={styles.footer.label}>EMAIL</label>
              <div className={styles.footer.inputWrapper}>
                <Mail className={styles.footer.inputIcon} />
                <input
                  type="email"
                  className={`${styles.footer.input} ${styles.footer.inputWithIcon}`}
                  value={mail}
                  onChange={(e) => {
                    const value = e.target.value;
                    setMail(value);
                  }}
                  placeholder="
            Digite seu email"
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-6 border-t border-white/5">
              <div>
                <p className="text-[12px] font-black text-[#8257E5] uppercase tracking-widest">
                  Total da Reserva
                </p>
                <p className="text-3xl font-black text-white font-mono">
                  R${" "}
                  {(selecionados.length * VALOR_UNITARIO)
                    .toFixed(2)
                    .replace(".", ",")}
                </p>
              </div>

             <button
              className={styles.footer.btnFinalizar}
              disabled={!nome || !telefone || !mail || selecionados.length === 0 || estaProcessando}
              onClick={handleFinalizar}
            >
              <CreditCard size={22} className="text-white" />
              {estaProcessando ? "PROCESSANDO..." : "PAGAR COM PIX"}
            </button>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
