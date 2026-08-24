import type { Metadata } from "next";
import AdminScreen from "@/Screens/AdminScreen/AdminScreen";
import { getAdminSession } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/userQueries";

export const metadata: Metadata = {
  title: "Admin — HomeSpread",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let initialSession = null;

  if (process.env.DATABASE_URL?.trim()) {
    const session = await getAdminSession();
    if (session) {
      const user = await getUserById(session.userId);
      if (user?.isAdmin && user.username) {
        initialSession = {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
        };
      }
    }
  }

  return <AdminScreen initialSession={initialSession} />;
}
