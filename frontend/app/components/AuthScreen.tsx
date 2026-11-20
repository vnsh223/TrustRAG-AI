"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

type AuthScreenProps = {
  onAuthenticated: (
    token: string,
    user: { id: number; email: string }
  ) => void;
};

type AuthResponse = {
  access_token?: string;
  token_type?: string;
  user_id?: number;
  email?: string;
  message?: string;
  detail?: string;
};

const QUESTION = "What projects are listed in my resume?";

const SOURCES = [
  { name: "resume.pdf", where: "page 1", score: 94 },
  { name: "github_readme.md", where: "section 2", score: 88 },
  { name: "interview_notes.txt", where: "page 3", score: 81 },
];

const METRICS = [
  { label: "Groundedness", value: 98 },
  { label: "Relevance", value: 96 },
  { label: "Faithfulness", value: 97 },
];

export default function AuthScreen({
  onAuthenticated,
}: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ---------- demo animation (decorative only) ----------
  const [typed, setTyped] = useState(0);
  const [step, setStep] = useState(0); // 0 typing, 1 sources, 2 answer, 3 verdict, 4 reset

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (step === 0) {
      if (typed < QUESTION.length) {
        t = setTimeout(() => setTyped(typed + 1), 45);
      } else {
        t = setTimeout(() => setStep(1), 500);
      }
    } else if (step < 4) {
      t = setTimeout(() => setStep(step + 1), step === 3 ? 4000 : 1500);
    } else {
      t = setTimeout(() => {
        setTyped(0);
        setStep(0);
      }, 400);
    }
    return () => clearTimeout(t);
  }, [typed, step]);

  // ---------- mouse spotlight on the form card ----------
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }

  // ---------- your original auth logic (unchanged) ----------
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError("");
    setSuccess("");
    setLoading(true);

    const endpoint = isLogin ? "/auth/login" : "/auth/register";

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data: AuthResponse = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Authentication failed. Please try again."
        );
      }

      if (!isLogin) {
        setSuccess("Account created successfully. Please log in.");
        setIsLogin(true);
        setPassword("");
        return;
      }

      if (!data.access_token || !data.user_id || !data.email) {
        throw new Error("The server returned an incomplete login response.");
      }

      onAuthenticated(data.access_token, {
        id: data.user_id,
        email: data.email,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function switchMode(login: boolean) {
    setIsLogin(login);
    setError("");
    setSuccess("");
    setPassword("");
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-[15px] text-white placeholder:text-slate-500 outline-none transition hover:border-white/20 focus:border-emerald-400/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_4px_rgba(52,211,153,0.12)]";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070d] text-white">
      {/* ===== background ===== */}
      <div className="pointer-events-none absolute inset-0">
        <div className="anim-float-a absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-emerald-500/25 blur-[130px]" />
        <div className="anim-float-b absolute -bottom-48 right-0 h-[620px] w-[620px] rounded-full bg-teal-600/30 blur-[140px]" />
        <div className="anim-float-a absolute left-1/2 top-1/3 h-[360px] w-[360px] rounded-full bg-teal-400/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-6 py-10 lg:grid-cols-2 lg:px-12">
        {/* ===== LEFT: brand + live demo ===== */}
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-bold shadow-[0_0_30px_rgba(52,211,153,0.45)]">
              T
            </div>
            <div>
              <div className="text-xl font-semibold tracking-tight">
                TrustRAG <span className="text-emerald-300">AI</span>
              </div>
              <p className="text-[10px] tracking-[2px] text-slate-400">
                INTELLIGENCE YOU CAN TRUST
              </p>
            </div>
          </div>

          <h1 className="mt-10 text-5xl font-semibold leading-[1.08] tracking-tight xl:text-6xl">
            Every answer,
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-400 bg-clip-text text-transparent">
              checked before
            </span>
            <br />
            it reaches you.
          </h1>

          <p className="mt-5 max-w-md text-base leading-relaxed text-slate-400">
            Ask questions about your own documents. A second AI judges each
            answer for truth, so you only see what you can trust.
          </p>

          {/* live demo card */}
          <div className="mt-10 min-h-[420px] max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              </div>
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Preview
              </span>
            </div>

            {/* question */}
            <div className="rounded-xl bg-white/[0.05] px-4 py-3 text-sm text-slate-200">
              {QUESTION.slice(0, typed)}
              {step === 0 && (
                <span className="anim-blink ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-emerald-300" />
              )}
              {step === 0 && typed === 0 && (
                <span className="text-slate-500">Ask anything…</span>
              )}
            </div>

            {/* sources */}
            {step >= 1 && step < 4 && (
              <div className="anim-rise mt-4 space-y-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Sources found
                </div>
                {SOURCES.map((s, i) => (
                  <div
                    key={s.name}
                    className="anim-rise flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                    style={{ animationDelay: `${i * 150}ms` }}
                  >
                    <span className="text-slate-300">
                      {s.name}{" "}
                      <span className="text-slate-500">· {s.where}</span>
                    </span>
                    <span className="text-emerald-300">{s.score}% match</span>
                  </div>
                ))}
              </div>
            )}

            {/* answer */}
            {step >= 2 && step < 4 && (
              <div className="anim-rise mt-4 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] px-4 py-3 text-sm leading-relaxed text-slate-200">
                Your resume lists three projects, including a document Q&amp;A
                app with an AI judge.
              </div>
            )}

            {/* verdict */}
            {step >= 3 && step < 4 && (
              <div className="anim-rise mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Judge verdict
                  </span>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                    ✓ PASS
                  </span>
                </div>
                <div className="space-y-2.5">
                  {METRICS.map((m) => (
                    <div key={m.label}>
                      <div className="mb-1 flex justify-between text-xs text-slate-400">
                        <span>{m.label}</span>
                        <span>{m.value}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="anim-bar h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-300"
                          style={{ width: `${m.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            {[
              { title: "Private", subtitle: "Your documents" },
              { title: "Grounded", subtitle: "Context-based AI" },
              { title: "Reliable", subtitle: "Evaluated answers" },
            ].map((item) => (
              <div key={item.title}>
                <p className="text-sm font-semibold text-slate-200">
                  {item.title}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {item.subtitle}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== RIGHT: auth card ===== */}
        <section className="flex justify-center lg:justify-end">
          <div
            onMouseMove={handleMouseMove}
            className="group relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:p-10"
          >
            {/* mouse spotlight */}
            <div
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{
                background:
                  "radial-gradient(380px circle at var(--mx, 50%) var(--my, 0%), rgba(52,211,153,0.14), transparent 60%)",
              }}
            />
            {/* top glow line */}
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

            <div className="relative">
              {/* mobile brand */}
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 font-bold">
                  T
                </div>
                <div>
                  <p className="text-lg font-semibold">
                    TrustRAG <span className="text-emerald-300">AI</span>
                  </p>
                  <p className="text-[10px] tracking-[2px] text-slate-400">
                    INTELLIGENCE YOU CAN TRUST
                  </p>
                </div>
              </div>

              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
                {isLogin ? "Welcome back" : "Get started"}
              </p>

              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                {isLogin ? "Sign in to your" : "Create your"}
                <br />
                <span className="bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent">
                  {isLogin ? "workspace." : "account."}
                </span>
              </h2>

              <p className="mt-3 text-sm leading-6 text-slate-400">
                {isLogin
                  ? "Enter your details to access your private AI workspace."
                  : "Create an account and start exploring your documents with AI."}
              </p>

              {/* Sign in / Create account tabs */}
              <div className="relative mt-7 grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <div
                  className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-white/10 transition-all duration-300"
                  style={{ left: isLogin ? "4px" : "50%" }}
                />
                <button
                  type="button"
                  onClick={() => switchMode(true)}
                  className={`relative z-10 rounded-lg py-2.5 text-sm font-medium transition ${
                    isLogin ? "text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => switchMode(false)}
                  className={`relative z-10 rounded-lg py-2.5 text-sm font-medium transition ${
                    !isLogin ? "text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Create account
                </button>
              </div>

              {/* Error message */}
              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-300"
                >
                  {error}
                </div>
              )}

              {/* Success message */}
              {success && (
                <div
                  role="status"
                  className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300"
                >
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className={inputClass}
                  />
                </div>

                {/* Password */}
                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={isLogin ? 1 : 8}
                      autoComplete={
                        isLogin ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        isLogin
                          ? "Enter your password"
                          : "Create a password (8+ characters)"
                      }
                      className={`${inputClass} pr-20`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 transition hover:text-emerald-300"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="group/btn relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-600 px-4 py-4 text-sm font-semibold text-white shadow-[0_10px_40px_rgba(20,184,166,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_50px_rgba(20,184,166,0.55)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Please wait...
                      </>
                    ) : (
                      <>
                        {isLogin
                          ? "Sign in to workspace"
                          : "Create your account"}
                        <span className="transition-transform group-hover/btn:translate-x-1">
                          →
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </form>

              {/* Security information */}
              <div className="mt-7 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mt-0.5 text-emerald-300">♢</div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    Your workspace, your privacy
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Your documents are separated by account. Sign in to
                    access your personal knowledge workspace.
                  </p>
                </div>
              </div>

              <p className="mt-8 text-center text-xs text-slate-500">
                © {new Date().getFullYear()} TrustRAG AI. All rights reserved.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}