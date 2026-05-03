import HomeView from "@/Views/HomeView/HomeView";
import DatabaseNotConfigured from "./DatabaseNotConfigured";
import { getListings } from "@/lib/db/queries";

/** Dados vêm do Postgres em cada pedido — não pré-renderizar sem DATABASE_URL no build. */
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!process.env.DATABASE_URL?.trim()) {
    return <DatabaseNotConfigured />;
  }

  const listings = await getListings();
  return <HomeView listings={listings} />;
}
