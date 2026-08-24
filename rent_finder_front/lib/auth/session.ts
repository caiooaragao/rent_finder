import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE = "rf_admin_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminSession = {
  userId: number;
  username: string;
};

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET is required in production");
  }
  return "dev-insecure-admin-secret";
}

export function signAdminSession(payload: AdminSession): string {
  const exp = Date.now() + SESSION_MS;
  const data = JSON.stringify({ ...payload, exp });
  const sig = createHmac("sha256", getSessionSecret()).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

export function verifyAdminSessionToken(token: string): AdminSession | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as { data: string; sig: string };

    const expected = createHmac("sha256", getSessionSecret())
      .update(parsed.data)
      .digest("hex");

    const sigBuf = Buffer.from(parsed.sig, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const payload = JSON.parse(parsed.data) as AdminSession & { exp: number };
    if (payload.exp < Date.now()) return null;

    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminSessionToken(token);
}

export async function setAdminSessionCookie(payload: AdminSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, signAdminSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}
