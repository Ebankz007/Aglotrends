import { ResetForm } from "@/components/reset-form";

export const metadata = {
  title: "Set a new password — Aglotrends",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6">
      <div className="rounded-3xl border border-white/10 bg-navy p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-mist">Your link works once and expires in an hour.</p>
        <div className="mt-6">
          <ResetForm token={token ?? ""} />
        </div>
      </div>
    </main>
  );
}
