import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Create account — Aglotrends",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ sponsor?: string }>;
}) {
  const { sponsor } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6">
      <div className="rounded-3xl border border-white/10 bg-navy p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-mist">
          Join Aglotrends and start building your network.
        </p>
        <div className="mt-6">
          <AuthForm mode="register" sponsorEmail={sponsor} />
        </div>
      </div>
    </main>
  );
}
