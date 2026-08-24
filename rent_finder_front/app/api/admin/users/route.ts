import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/requireAdminApi";
import { createAdminUser, listUsers } from "@/lib/db/userQueries";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json(
      { error: "DATABASE_URL não configurado" },
      { status: 503 },
    );
  }

  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao listar usuários";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json(
      { error: "DATABASE_URL não configurado" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      fullName?: string;
      phone?: string;
    };

    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username || username.length < 3) {
      return NextResponse.json(
        { error: "Usuário deve ter pelo menos 3 caracteres" },
        { status: 400 },
      );
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: "Senha deve ter pelo menos 6 caracteres" },
        { status: 400 },
      );
    }

    const user = await createAdminUser({
      username,
      password,
      fullName: body.fullName,
      phone: body.phone,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao criar usuário";
    const status = message.includes("unique") ? 409 : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? "Este nome de usuário já está em uso"
            : message,
      },
      { status },
    );
  }
}
