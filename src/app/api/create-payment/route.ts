import { NextResponse } from "next/server";

type CreatePaymentBody = {
  nome: string;
  mail: string;
  numeros: number[];
  valorTotal: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreatePaymentBody;
    const { nome, mail, numeros, valorTotal } = body;

    if (
      typeof nome !== "string" ||
      !nome.trim() ||
      typeof mail !== "string" ||
      !mail.trim() ||
      !/^\S+@\S+\.\S+$/.test(mail) ||
      !Array.isArray(numeros) ||
      numeros.length === 0 ||
      typeof valorTotal !== "number" ||
      valorTotal <= 0
    ) {
      return NextResponse.json(
        { error: "Dados inválidos enviados" },
        { status: 400 }
      );
    }

    const notificationUrl =
      process.env.MP_NOTIFICATION_URL ||
      "https://rifa-smartlucky.vercel.app/api/webhooks/mercadopago";

    console.log("=== CREATE-PAYMENT ===");
    console.log("Notification URL:", notificationUrl);
    console.log("MP_NOTIFICATION_URL env:", process.env.MP_NOTIFICATION_URL);

    const paymentPayload = {
      transaction_amount: valorTotal,
      description: `Rifa SmartLucky - Números: ${numeros.join(", ")}`,
      payment_method_id: "pix",
      external_reference: `RIFAS-${Date.now()}`,
      notification_url: notificationUrl,
      payer: {
        email: mail,
        first_name: nome,
      },
    };

    console.log("Payment payload:", JSON.stringify(paymentPayload));

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(paymentPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro Mercado Pago ao criar pagamento:", data);
      return NextResponse.json(
        { error: data.message ?? "Erro ao criar pagamento" },
        { status: response.status }
      );
    }

    console.log("Payment criado com sucesso:");
    console.log("ID:", data.id);
    console.log("Status:", data.status);
    console.log("Notification URL registrada:", data.notification_url);

    return NextResponse.json({
      id: data.id,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64:
        data.point_of_interaction?.transaction_data?.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro create-payment:", error);
    return NextResponse.json(
      { error: "Erro interno no servidor" },
      { status: 500 }
    );
  }
}
