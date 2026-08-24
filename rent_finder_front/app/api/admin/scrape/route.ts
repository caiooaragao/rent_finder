import { NextResponse } from "next/server";
import {
  getScrapeState,
  isScrapeRunning,
  startScrapeStream,
} from "@/lib/admin/scrapeRunner";
import { requireAdminApi } from "@/lib/auth/requireAdminApi";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const scrape = getScrapeState();
  return NextResponse.json({
    running: scrape.running,
    logs: scrape.logs,
    exitCode: scrape.exitCode,
  });
}

export async function POST() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (isScrapeRunning()) {
    return NextResponse.json(
      { error: "Já existe um scrape em execução" },
      { status: 409 },
    );
  }

  try {
    const stream = startScrapeStream();
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao iniciar scrape";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
