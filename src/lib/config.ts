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

export type StatusRifa = "pendente" | "pago";
