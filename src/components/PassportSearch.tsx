import { useState } from "react";
import { Search, X, KeyRound } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useAccess } from "@/lib/access-context";
import { PrivateHubTransition } from "@/components/PrivateHubTransition";
import { books } from "@/data/books";
import { Link } from "@tanstack/react-router";

/**
 * Hidden passport gate inside the public search bar.
 * - Typing Passport-1 and pressing enter (or tapping the key icon) checks
 *   the RPC. On success the second input appears.
 * - Typing Passport-2 and clicking Validate opens the Private Hub.
 * - When either code is wrong, the UI behaves like a normal search bar.
 */
export function PassportSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { grantAccess } = useAccess();
  const [query, setQuery] = useState("");
  const [showSecond, setShowSecond] = useState(false);
  const [second, setSecond] = useState("");
  const [entering, setEntering] = useState(false);

  const results = query.trim()
    ? books
        .filter((b) =>
          `${b.title} ${b.author}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];

  const checkFirst = async () => {
    const code = query.trim();
    if (!code) return;
    const { data } = await supabase.rpc("verify_passport_first", { code });
    if (data === true) setShowSecond(true);
  };

  const validate = async () => {
    const code1 = query.trim();
    const code2 = second.trim();
    if (!code1 || !code2) return;
    const { data } = await supabase.rpc("verify_passport_both", { code1, code2 });
    if (data === true) {
      grantAccess();
      setEntering(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#0a0a0f]/95 px-4 pt-16 backdrop-blur-lg">
      {entering && <PrivateHubTransition onComplete={() => navigate({ to: "/hub" })} />}
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 rounded-2xl border border-[#c9a84c]/40 bg-[#141420] px-3 py-2 shadow-[0_0_20px_rgba(201,168,76,0.15)]">
          <Search className="h-4 w-4 text-[#c9a84c]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") checkFirst();
            }}
            placeholder="Search books, authors..."
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 outline-none"
          />
          <button
            aria-label="Enter"
            onClick={checkFirst}
            className="rounded-full p-1 text-[#c9a84c]/60 transition-colors hover:text-[#c9a84c]"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button aria-label="Close" onClick={onClose} className="rounded-full p-1 text-neutral-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {showSecond && (
          <div className="mt-3 animate-slide-down space-y-2 rounded-2xl border border-[#c9a84c]/50 bg-[#141420] p-3 shadow-[0_0_28px_rgba(201,168,76,0.25)]">
            <input
              autoFocus
              type="password"
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              placeholder="Enter passport..."
              className="w-full rounded-xl border border-[#c9a84c]/40 bg-[#0a0a0f] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-[#c9a84c]"
            />
            <button
              onClick={validate}
              className="w-full rounded-xl bg-gradient-to-r from-[#e6c76a] via-[#c9a84c] to-[#8a6b1f] py-2 font-heading text-sm font-semibold tracking-widest text-[#1a1408] shadow-[0_0_18px_rgba(201,168,76,0.5)]"
            >
              VALIDATE
            </button>
          </div>
        )}

        {results.length > 0 && !showSecond && (
          <ul className="mt-3 space-y-2">
            {results.map((b) => (
              <li key={b.id}>
                <Link
                  to="/reader/$id"
                  params={{ id: b.id }}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#141420] px-3 py-2 transition-colors hover:border-[#c9a84c]/40"
                >
                  <img src={b.cover_url} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-100">{b.title}</p>
                    <p className="truncate text-xs text-neutral-500">{b.author}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}