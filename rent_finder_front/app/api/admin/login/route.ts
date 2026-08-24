import { NextResponse } from "next/server";
import { ensureRootAdmin } from "@/lib/auth/bootstrapRootAdmin";
import { verifyPassword } from "@/lib/auth/password";
import { setAdminSessionCookie } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/db/userQueries";

export async function POST(request: Request) {
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
    };

    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Usuário e senha são obrigatórios" },
        { status: 400 },
      );
    }

    await ensureRootAdmin();

    const user = await getUserByUsername(username);
    if (!user?.isAdmin || !user.passwordHash) {
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 },
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 },
      );
    }

    await setAdminSessionCookie({
      userId: user.id,
      username: user.username!,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao autenticar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
