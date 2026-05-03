import { getListings } from "@/lib/db/queries";

export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) {
    return Response.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  try {
    const listings = await getListings();
    return Response.json(listings);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database error";
    return Response.json({ error: message }, { status: 500 });
  }
}
