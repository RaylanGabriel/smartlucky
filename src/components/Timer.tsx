"use client";

import { useEffect, useState } from "react";

function formatar(ms: number): string {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
}

export default function Timer({
  expiraEm,
  onExpirar,
}: {
  expiraEm: string;
  onExpirar: () => void;
}) {
  const [restante, setRestante] = useState(() => new Date(expiraEm).getTime() - Date.now());
  useEffect(() => {
    const fim = new Date(expiraEm).getTime();
    const tick = () => {
      const diff = fim - Date.now();
      setRestante(diff);
      if (diff <= 0) {
        clearInterval(intervalo);
        onExpirar();
      }
    };
    const intervalo = setInterval(tick, 1000);
    return () => clearInterval(intervalo);
  }, [expiraEm, onExpirar]);

  return (
    <div className="w-full text-center p-3 bg-[#17171B] rounded-xl border border-red-500/20 mb-4">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
        Sua reserva expira em
      </p>
      <span className="text-2xl font-mono text-red-500 font-bold">{formatar(restante)}</span>
    </div>
  );
}
