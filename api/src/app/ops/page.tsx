import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OPS_COOKIE, verifyOpsCookie } from "@/lib/ops/auth";
import { gatherOps } from "@/lib/ops/gather";
import { LoginForm } from "./login-form";
import { Dashboard, Shell } from "./dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sprouts ops", robots: { index: false, follow: false } };

export default async function OpsPage() {
  const jar = await cookies();
  // No valid cookie: only the login form is rendered and nothing is gathered.
  if (!verifyOpsCookie(jar.get(OPS_COOKIE)?.value, Date.now())) {
    return (
      <Shell>
        <h1>Sprouts ops</h1>
        <LoginForm />
      </Shell>
    );
  }
  return <Dashboard snap={await gatherOps()} nowMs={Date.now()} />;
}
