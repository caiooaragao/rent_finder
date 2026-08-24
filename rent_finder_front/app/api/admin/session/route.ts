import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/userQueries";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json({
      authenticated: true,
      user: { username: session.username },
    });
  }

  const user = await getUserById(session.userId);
  if (!user?.isAdmin) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
    },
  });
}
