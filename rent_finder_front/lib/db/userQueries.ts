import { desc, eq } from "drizzle-orm";
import { getDb } from "./drizzle";
import { users } from "./schema";
import { hashPassword } from "@/lib/auth/password";

export type PublicUser = {
  id: number;
  username: string;
  fullName: string | null;
  phone: string | null;
  isAdmin: boolean;
  createdAt: Date;
};

export async function getUserByUsername(username: string) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return user ?? null;
}

export async function getUserById(id: number) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      phone: users.phone,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.isAdmin, true))
    .orderBy(desc(users.createdAt));

  return rows.filter(
    (row): row is PublicUser => typeof row.username === "string",
  );
}

export async function createAdminUser(input: {
  username: string;
  password: string;
  fullName?: string;
  phone?: string;
}): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  const [created] = await getDb()
    .insert(users)
    .values({
      username: input.username.trim(),
      passwordHash,
      fullName: input.fullName?.trim() || null,
      phone: input.phone?.trim() || null,
      isAdmin: true,
    })
    .returning({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      phone: users.phone,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    });

  if (!created?.username) {
    throw new Error("Falha ao criar usuário");
  }

  return created as PublicUser;
}
