import { NextResponse } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/lib/firebase/admin";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    const decoded = await getFirebaseAdminAuth().verifyIdToken(authorization.slice(7));
    const requester = await getFirebaseAdminDb().collection("users").doc(decoded.uid).get();
    if (!requester.exists || !["admin", "gerente"].includes(requester.data()?.role)) return NextResponse.json({ error: "Apenas administração pode resetar senhas." }, { status: 403 });
    const { userId } = await request.json() as { userId?: string };
    if (!userId) return NextResponse.json({ error: "Usuário não informado." }, { status: 400 });
    await getFirebaseAdminAuth().updateUser(userId, { password: "123456" });
    await getFirebaseAdminDb().collection("users").doc(userId).set({ mustChangePassword: true, updatedAt: new Date() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível resetar a senha." }, { status: 500 });
  }
}
