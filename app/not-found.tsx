import Link from "next/link";
import { IdolAvatar } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <IdolAvatar size={72} />
      <h1 className="text-xl font-bold">这个页面不在舞台上</h1>
      <p className="text-sm text-muted">地址可能打错了，我带你回到首页吧～</p>
      <Link href="/" className="btn-primary">
        回到首页
      </Link>
    </div>
  );
}
