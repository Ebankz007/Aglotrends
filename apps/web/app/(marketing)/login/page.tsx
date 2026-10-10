import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Sign in — Aglotrends",
};

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6">
      <div className="rounded-3xl border border-white/10 bg-navy p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-mist">Sign in to your Aglotrends account.</p>
        <div className="mt-6">
          <AuthForm mode="login" />
        </div>
      </div>
    </main>
  );
}
