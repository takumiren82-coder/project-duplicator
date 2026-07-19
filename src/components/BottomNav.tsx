import { Link } from "@tanstack/react-router";
import { Images, MessageCircle, Clapperboard, CircleDashed } from "lucide-react";

export function BottomNav({ active }: { active: "gallery" | "chats" | "reels" | "status" }) {
  const items = [
    { key: "gallery", label: "Gallery", to: "/hub/gallery", Icon: Images },
    { key: "status", label: "Status", to: "/hub/status", Icon: CircleDashed },
    { key: "chats", label: "Chat", to: "/hub", Icon: MessageCircle },
    { key: "reels", label: "Reels", to: "/hub/reels", Icon: Clapperboard },
  ] as const;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border/40 bg-[#0d0518]/90 px-2 pb-3 pt-2 backdrop-blur-xl">
      {items.map(({ key, label, to, Icon }) => {
        const isActive = active === key;
        return (
          <Link
            key={key}
            to={to}
            className={`flex flex-1 flex-col items-center gap-1 transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Icon
              className="h-5 w-5"
              strokeWidth={isActive ? 2.4 : 1.8}
              style={isActive ? { filter: "drop-shadow(0 0 8px var(--gold))" } : undefined}
            />
            <span className={`text-[10px] tracking-wide ${isActive ? "font-semibold" : "font-medium"}`}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
