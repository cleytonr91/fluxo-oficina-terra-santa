import { NextResponse } from "next/server";
import { runAutomaticHgsiImport } from "@/lib/hgsi/automatic-import";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET não configurado." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runAutomaticHgsiImport();
    return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, ...result });
  } catch (error) {
    console.error("Falha na importação automática HGSI", error instanceof Error ? error.message : error);
    return NextResponse.json({
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Falha inesperada na importação HGSI.",
    }, { status: 500 });
  }
}
