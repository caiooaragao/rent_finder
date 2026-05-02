import { getListings } from "@/lib/db/queries";

export async function GET() {
  const listings = await getListings();
  return Response.json(listings);
}
