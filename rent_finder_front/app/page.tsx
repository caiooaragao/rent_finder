import HomeView from "@/Views/HomeView/HomeView";
import DatabaseNotConfigured, {
  DatabaseLoadFailed,
} from "./DatabaseNotConfigured";
import { getListings } from "@/lib/db/queries";

/** Dados vêm do Postgres em cada pedido — não pré-renderizar sem DATABASE_URL no build. */
export const dynamic = "force-dynamic";
/** Hobby cap is 10s; Pro can use this. Large listing queries need headroom. */
export const maxDuration = 30;

export default async function Home() {
  if (!process.env.DATABASE_URL?.trim()) {
    return <DatabaseNotConfigured />;
  }

  try {
    const listings = await getListings();
    return <HomeView listings={listings} />;
  } catch (e) {
    console.error("[home] failed to load listings", e);
    return <DatabaseLoadFailed />;
  }
}
