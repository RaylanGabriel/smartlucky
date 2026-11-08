# SmartLucky — Rifa online com PIX

Rifa de 500 números com pagamento via PIX (Mercado Pago), confirmação automática por webhook e painel administrativo.

**Produção:** https://smartlucky.vercel.app

**Stack:** Next.js 16 (App Router) · Supabase (Postgres) · Mercado Pago (PIX) · Brevo (e-mail) · Vercel

---

## Como funciona

```
Comprador escolhe números ──► POST /api/create-payment
                                 │ valida dados, aplica limites anti-abuso
                                 │ reserva os números no banco (status "pendente")
                                 │ gera o PIX no Mercado Pago (valor calculado no servidor, expira em 30 min)
                                 ▼
                      /pagamento?id=<payment_id>
                                 │ mostra QR Code / copia-e-cola
                                 │ consulta /api/webhooks/check-payment a cada 5 s
                                 ▼
Mercado Pago ──► POST /api/webhooks/mercadopago
                                 │ consulta o pagamento na API do MP
                                 │ confere o valor pago
                                 │ marca as reservas como "pago" (uma única vez)
                                 └► envia e-mail de confirmação (Brevo)

pg_cron (a cada 5 min) ──► GET /api/webhooks/process-pending
                                 │ reprocessa webhooks que falharam
                                 └► libera reservas vencidas (antes cancela o PIX no MP)
```

Regras principais:

- **O servidor é a fonte da verdade.** Preço, limites e disponibilidade são calculados no back-end; o navegador nunca acessa o Supabase diretamente.
- **Um número só pode ser vendido uma vez:** há um índice `UNIQUE` em `rifas.numero_escolhido`.
- **Confirmação idempotente:** a troca `pendente → pago` é um update condicional, então webhook, polling e cron podem rodar ao mesmo tempo sem duplicar o e-mail.
- **Reserva vencida só é liberada depois de consultar o Mercado Pago.** Se foi paga, é confirmada. Se ainda está pendente, o PIX é cancelado antes de liberar o número.

## Estrutura

```
src/
├── app/
│   ├── page.tsx                      # Escolha de números e formulário
│   ├── pagamento/page.tsx            # QR Code + acompanhamento do pagamento
│   ├── admin/                        # Painel e login do administrador
│   └── api/
│       ├── create-payment/           # Reserva números + gera PIX
│       ├── numeros/                  # Lista números ocupados (sem dados pessoais)
│       ├── admin/{login,logout,vendas,acoes}/   # Rotas protegidas por sessão
│       └── webhooks/
│           ├── mercadopago/          # Webhook do Mercado Pago
│           ├── check-payment/        # Polling da página de pagamento
│           └── process-pending/      # Chamado pelo cron (protegido por CRON_SECRET)
├── components/                       # NumeroRifa, Timer
└── lib/
    ├── config.ts                     # Preço, limites e prazos da rifa
    ├── payments.ts                   # Criar / confirmar / cancelar / expirar pagamentos
    ├── admin-auth.ts                 # Sessão do admin (cookie httpOnly assinado com HMAC)
    ├── rate-limit.ts                 # Limite de requisições por origem
    ├── email.ts                      # E-mail de confirmação (Brevo)
    └── supabase-admin.ts             # Cliente Supabase com service role (só no servidor)
supabase/migrations/                  # SQL do banco (rodar no SQL Editor do Supabase)
```

## Configuração

### Variáveis de ambiente

Cadastre na Vercel (Settings → Environment Variables) e, para rodar localmente, num arquivo `.env`. Marque os segredos como **Sensitive**.

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role (**segredo**, só no servidor) |
| `MP_ACCESS_TOKEN` | Access token de produção do Mercado Pago (**segredo**) |
| `NEXT_PUBLIC_MP_PUBLIC_KEY` | Public key do Mercado Pago (SDK no navegador) |
| `MP_NOTIFICATION_URL` | `https://smartlucky.vercel.app/api/webhooks/mercadopago` |
| `MP_WEBHOOK_SECRET` | *(opcional)* Valida o header `x-signature` do webhook |
| `BREVO_API_KEY` | Envio de e-mail (**segredo**) |
| `BREVO_SENDER_EMAIL` | *(opcional)* Remetente verificado no Brevo |
| `ADMIN_USUARIO` / `ADMIN_SENHA` | Credenciais do painel admin (**segredo**) |
| `ADMIN_SESSION_SECRET` | Assina o cookie de sessão; mínimo de 32 caracteres aleatórios (**segredo**) |
| `CRON_SECRET` | Protege `/api/webhooks/process-pending` (**segredo**) |

Para gerar valores aleatórios para `ADMIN_SESSION_SECRET` e `CRON_SECRET`, use um valor diferente para cada:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> Nunca use o prefixo `NEXT_PUBLIC_` em segredos: tudo com esse prefixo vai para o JavaScript público do site.

### Banco de dados (Supabase)

Rode os arquivos de `supabase/migrations/` em ordem no **SQL Editor** do Supabase:

1. `20261107_seguranca.sql`: fecha o RLS (nenhum acesso com a chave anon), cria o índice único por número, corrige defaults e remove a limpeza antiga de 15 minutos.
2. `20261108_rate_limit_cron.sql`: cria a tabela e a função de limite de requisições, a coluna `ip_hash` e agenda o cron.

Antes do cron funcionar, guarde o `CRON_SECRET` no Vault uma única vez, com o mesmo valor cadastrado na Vercel:

```sql
select vault.create_secret('<VALOR_DO_CRON_SECRET>', 'cron_secret');
```

Para conferir as execuções do cron:

```sql
select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;
select status_code, created, content from net._http_response order by created desc limit 5;
```

### Mercado Pago

- A conta precisa ter uma **chave PIX cadastrada** (app do Mercado Pago → Pix → Minhas chaves). Sem ela, a API devolve `Collector user without key enabled for QR render` (código `13253`) e nenhum PIX é gerado.
- O PIX expira em 30 minutos, o mínimo aceito pelo Mercado Pago.

### Rodando localmente

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # build de produção (inclui checagem de tipos)
npm run lint
```

O webhook não alcança `localhost`. Localmente, a confirmação acontece pelo polling da página `/pagamento`.

### Deploy

O deploy é automático na Vercel a cada push na `main`.

**Ordem importa:** quando uma mudança depende de coluna ou tabela nova, rode a migração **antes** do deploy. Quando a migração remove acesso que o código antigo usa, publique o código **antes**.

## Segurança

| Proteção | Como |
|---|---|
| Acesso ao banco | RLS ativo e sem policies; privilégios de `anon`/`authenticated` revogados. Só o servidor (service role) lê e escreve. |
| Dados pessoais | O navegador recebe só os números ocupados (`/api/numeros`). O IP é guardado apenas como hash HMAC. |
| Preço e valor pago | Calculados no servidor; a confirmação recusa pagamento com valor menor que o esperado. |
| Venda dupla | Índice único por número + reserva feita antes de gerar o PIX. |
| Painel admin | Credenciais só no servidor, cookie `httpOnly` + `SameSite=Strict` assinado com HMAC, sessão de 8 h. |
| Webhook | Dados sempre buscados na API do MP (notificação falsa não aprova nada); `x-signature` validado quando `MP_WEBHOOK_SECRET` está definido. |
| Cron | `process-pending` exige `Authorization: Bearer <CRON_SECRET>`; o segredo fica no Vault do Supabase. |
| QR Code | Gerado pelo próprio Mercado Pago (base64); o código PIX não é enviado a terceiros. |

### Limites anti-abuso (por origem/IP)

| Rota | Limite |
|---|---|
| Gerar PIX | 10 tentativas a cada 10 min |
| Números reservados sem pagar | até 20 ao mesmo tempo |
| Login do admin | 5 tentativas a cada 15 min |
| Consulta de status do pagamento | 60 por minuto |

Os limites são folgados para não barrar pessoas que compartilham o mesmo IP (rede de operadora, Wi-Fi público). Eles barram scripts simples, mas não ataques distribuídos; para isso, use o Firewall da Vercel. Se o banco do limitador falhar, a requisição é liberada para não derrubar o site. Os valores ficam em `src/lib/config.ts`.

## Operação

- **Liberar um número manualmente:** painel `/admin` → excluir a reserva.
- **Confirmar pagamento manualmente:** painel `/admin` → confirmar (não envia e-mail).
- **Pagamento aprovado sem reserva** (por exemplo, reserva excluída no admin): aparece nos logs como `ATENÇÃO: pagamento ... aprovado sem reservas` e na tabela `webhook_queue` com status `sem_reserva`. Exige ação manual.
- **Valor divergente:** a reserva fica pendente e a `webhook_queue` recebe o status `valor_divergente`. Exige ação manual.
- **Estorno após a confirmação:** não libera o número automaticamente; use o admin.
- **Desbloquear um IP no limite** (por exemplo, após errar o login): apague as linhas correspondentes em `public.rate_limits`.

## Histórico da revisão de segurança (nov/2026)

Problemas encontrados e corrigidos:

- A rota de ações do admin não tinha autenticação e usava a service role: qualquer pessoa podia apagar reservas ou marcá-las como pagas.
- A senha do admin estava em variáveis `NEXT_PUBLIC_*`, visível no JavaScript do site.
- O preço vinha do navegador: era possível pagar R$ 0,01 por 10 números.
- O RLS liberava INSERT, SELECT e UPDATE públicos: dava para ler nome, e-mail e telefone de todos os compradores, ou gravar reservas como "pago". A `webhook_queue` estava sem RLS.
- A URL do webhook apontava para um domínio que não era o do projeto, então os webhooks nunca chegavam.
- Com mais de um número, `.single()` falhava: os e-mails saíam sem os números e eram reenviados.
- Não havia índice único: dois compradores podiam levar o mesmo número.
- O pg_cron apagava reservas após 15 min sem consultar o Mercado Pago.
- O QR Code era gerado num serviço de terceiros.
- Não havia limite de requisições, e o `process-pending` era público.
