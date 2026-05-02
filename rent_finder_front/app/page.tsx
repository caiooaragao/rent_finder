import HomeView from "@/Views/HomeView/HomeView";
import { getListings } from "@/lib/db/queries";

export default async function Home() {
  const listings = await getListings();
  return <HomeView listings={listings} />;
}
