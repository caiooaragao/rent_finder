import HomeScreen from "@/Screens/HomeScreen/HomeScreen";
import type { OlxListing } from "@/types/olx";

interface HomeViewProps {
  listings: OlxListing[];
}

export default function HomeView({ listings }: HomeViewProps) {
  return <HomeScreen listings={listings} />;
}