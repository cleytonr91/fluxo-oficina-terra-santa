import { NextResponse } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roles: UserRole[] = [
  "admin",
  "gerente",
  "chefe_oficina",
  "consultor",
  "tecnico",
  "lider_lavagem",
  "consultor_funilaria",
  "estoquista",
  "qualidade",
  "agendamento",
];

async function authorize(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const decoded = await getFirebaseAdminAuth().verifyIdToken(authorization.slice(7));
  const requester = await getFirebaseAdminDb().collection("users").doc(decoded.uid).get();
  if (!requester.exists || !["admin", "gerente"].includes(requester.data()?.role)) return null;
  return decoded.uid;
}

export async function GET(request: Request) {
  try {
    if (!await authorize(request)) return NextResponse.json({ error: "Apenas administração pode consultar usuários." }, { status: 403 });
    const snapshot = await getFirebaseAdminDb().collection("users").get();
    const users = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        name: typeof data.name === "string" ? data.name : "",
        email: typeof data.email === "string" ? data.email : "",
        role: data.role,
        active: data.active === true,
        allowedPaths: Array.isArray(data.allowedPaths) ? data.allowedPaths : undefined,
        mustChangePassword: data.mustChangePassword === true,
      };
    });
    return NextResponse.json({ users });
  } catch (error) {
    console.error("[admin/users] list failed", error);
    return NextResponse.json({ error: "Não foi possível carregar os usuários." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!await authorize(request)) return NextResponse.json({ error: "Apenas administração pode alterar usuários." }, { status: 403 });
    const body = await request.json() as { userId?: string; name?: string; role?: UserRole; active?: boolean; allowedPaths?: string[] };
    if (!body.userId || !body.name?.trim() || !body.role || !roles.includes(body.role) || typeof body.active !== "boolean" || !Array.isArray(body.allowedPaths)) {
      return NextResponse.json({ error: "Dados do usuário inválidos." }, { status: 400 });
    }
    await getFirebaseAdminDb().collection("users").doc(body.userId).set({
      name: body.name.trim(),
      role: body.role,
      active: body.active,
      allowedPaths: body.allowedPaths.filter((path): path is string => typeof path === "string"),
      updatedAt: new Date(),
    }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/users] update failed", error);
    return NextResponse.json({ error: "Não foi possível salvar o usuário." }, { status: 500 });
  }
}
