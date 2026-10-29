import { PrismLogo, IdolAvatar } from "./Logo";

/** 部署后缺环境变量 / 存储时显示 */
export function SetupProblems({ problems }: { problems: string[] }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card w-full max-w-lg p-7">
        <div className="mb-5 flex items-center gap-3">
          <PrismLogo size={36} />
          <div className="text-lg font-bold">Prism 还差一点点就能开演</div>
        </div>
        <div className="mb-5 flex items-start gap-3">
          <IdolAvatar size={40} />
          <p className="rounded-2xl rounded-tl-md bg-soft px-3.5 py-2.5 text-sm leading-relaxed">
            我检查了一下部署环境，下面这些还没配好。在 Vercel 项目的 Settings → Environment Variables 里补上，然后重新部署就好啦。
          </p>
        </div>
        <ul className="space-y-3 text-sm">
          {problems.includes("PRISM_SECRET") && (
            <li className="rounded-xl border border-rule p-3">
              <b>PRISM_SECRET</b>：用来加密上游 Key 和签发登录凭证，填一串 32 位以上的随机字符。设好以后不要再改，否则已保存的 Key 会解不开。
            </li>
          )}
          {problems.includes("DATABASE") && (
            <li className="rounded-xl border border-rule p-3">
              <b>DATABASE_URL</b>：在 Aiven 上开一个免费的 MySQL，把服务概览页里的 Service URI 填进来（形如 mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED）。再把同一页能下载的 CA 证书整段填进 <b>DATABASE_CA_CERT</b>。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
