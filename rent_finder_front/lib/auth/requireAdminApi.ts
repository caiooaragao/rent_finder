import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";

export async function requireAdminApi(): Promise<
  { session: { userId: number; username: string } } | NextResponse
> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return { session };
}
