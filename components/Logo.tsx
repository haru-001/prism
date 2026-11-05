"use client";

import { avatarSrc, type Mood } from "@/lib/rinne";
import { useRinne } from "@/components/rinne/RinneProvider";

export function PrismLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-label="Prism">
      <rect width="64" height="64" rx="16" fill="#1b1830" />
      <line x1="6" y1="35" x2="25" y2="35" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".9" />
      <path d="M32 14 L48 44 L16 44 Z" fill="#fff" />
      <line x1="40" y1="30" x2="58" y2="22" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" />
      <line x1="41" y1="34" x2="58" y2="34" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" />
      <line x1="40" y1="38" x2="58" y2="46" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <PrismLogo size={small ? 26 : 32} />
      <span className={`font-extrabold tracking-tight ${small ? "text-base" : "text-lg"}`}>Prism</span>
    </div>
  );
}

/** 棱音头像：跟着当前服装和状态，64/128 两档，同域加载 */
export function IdolAvatar({ size = 28, mood = "welcome", className = "" }: { size?: number; mood?: Mood; className?: string }) {
  const { outfit } = useRinne();
  const a = avatarSrc(outfit, mood);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={a.src}
      srcSet={a.srcSet}
      alt="棱音"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-full bg-[#d8d8da] object-cover ring-2 ring-white/70 dark:ring-white/10 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
