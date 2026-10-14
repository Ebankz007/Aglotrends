import { ForgotForm } from "@/components/forgot-form";

export const metadata = {
  title: "Forgot password — Aglotrends",
};

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6">
      <div className="rounded-3xl border border-white/10 bg-navy p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-mist">We&apos;ll email you a one-time link.</p>
        <div className="mt-6">
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
