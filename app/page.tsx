import { isAuthed } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";
import Login from "@/components/Login";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  const token = typeof reset === "string" && /^[\w-]{20,100}$/.test(reset) ? reset : undefined;
  if (token) return <Login resetToken={token} />;
  return (await isAuthed()) ? <Dashboard /> : <Login />;
}
