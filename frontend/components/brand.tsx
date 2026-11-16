import Link from "next/link";

export function Brand() {
  return <Link href="/" className="brand" aria-label="LinguaLens home">
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="34" height="34" rx="10" fill="#132341" stroke="#385382" />
      <path d="M18 11v6m0 0-7 7m7-7 7 7" stroke="#9bb8ff" strokeWidth="1.6" />
      <circle cx="18" cy="10.5" r="2.8" fill="#a4c2ff" />
      <circle cx="10.5" cy="24" r="2.7" fill="#48dedf" />
      <circle cx="25.5" cy="24" r="2.7" fill="#a38cfb" />
    </svg>
    <span>Lingua<span>Lens</span></span>
  </Link>;
}
