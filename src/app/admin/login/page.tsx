"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { styles } from "@/app/styles";
import { Lock, User } from "lucide-react";

export default function LoginPage() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    try {
      // A verificação acontece no servidor; as credenciais não ficam no bundle.
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      if (res.ok) {
        router.push("/admin");
      } else {
        alert("Credenciais inválidas!");
      }
    } catch {
      alert("Erro ao conectar com o servidor.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className={`${styles.main} flex items-center justify-center`}>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-100 h-100 bg-[#8257E5] opacity-20 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="bg-[#121214] border border-[#29292E] p-8 rounded-2xl shadow-2xl">
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-black text-white uppercase">
              Smart<span className="text-[#8257E5]">Admin</span>
            </h1>
            <p className="text-[#A8A8B3] text-sm mt-2 font-medium">Faça login para gerir as rifas</p>
          </header>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className={styles.footer.inputWrapper}>
              <User className={styles.footer.inputIcon} />
              <input
                type="text"
                placeholder="Utilizador"
                autoComplete="username"
                className={`${styles.footer.input} pl-12`}
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
              />
            </div>

            <div className={styles.footer.inputWrapper}>
              <Lock className={styles.footer.inputIcon} />
              <input
                type="password"
                placeholder="Senha"
                autoComplete="current-password"
                className={`${styles.footer.input} pl-12`}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>

            <button type="submit" disabled={enviando} className={styles.footer.btnFinalizar}>
              {enviando ? "Entrando..." : "Acessar Painel"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
