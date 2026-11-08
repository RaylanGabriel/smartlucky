// Configurações da rifa compartilhadas entre front-end e servidor.
// O servidor é a fonte da verdade: preço e limites são sempre recalculados lá.

export const TOTAL_NUMEROS = 500;
export const NUMEROS_POR_PAGINA = 100;
export const LIMITE_SELECAO = 10;
export const VALOR_UNITARIO = 1; // em reais

// O Mercado Pago exige no mínimo 30 minutos de validade para um PIX.
export const RESERVA_MINUTOS = 30;
// Folga antes de liberar uma reserva vencida (atraso de webhook etc.).
export const FOLGA_LIBERACAO_MINUTOS = 5;

// Limites anti-abuso por origem (IP). Folgados para não barrar pessoas
// atrás do mesmo IP (rede de operadora, Wi-Fi compartilhado).
export const MAX_PIX_POR_JANELA = 10; // tentativas de gerar PIX...
export const JANELA_PIX_SEGUNDOS = 10 * 60; // ...a cada 10 minutos
export const MAX_NUMEROS_PENDENTES_POR_IP = 20; // números reservados sem pagar

export type StatusRifa = "pendente" | "pago";
