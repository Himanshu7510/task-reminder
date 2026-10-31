import { isAuthed } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";
import Login from "@/components/Login";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (await isAuthed()) ? <Dashboard /> : <Login />;
}
