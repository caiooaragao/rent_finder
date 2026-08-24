import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

const ROOT_USERNAME =
  process.env.ADMIN_ROOT_USERNAME?.trim() || "caioaragao";
const ROOT_PASSWORD =
  process.env.ADMIN_ROOT_PASSWORD?.trim() || "dantenovaesaguardente";

export async function ensureRootAdmin(): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, ROOT_USERNAME))
    .limit(1);

  if (existing) return;

  const passwordHash = await hashPassword(ROOT_PASSWORD);
  await db.insert(users).values({
    username: ROOT_USERNAME,
    passwordHash,
    fullName: "Administrador",
    isAdmin: true,
  });
}
