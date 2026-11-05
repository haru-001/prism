import { headers } from "next/headers";
import { ChatView } from "@/components/chat/ChatView";
import { isAuthed } from "@/lib/server/auth";
import { getConversation } from "@/lib/server/store";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 直接打开对话页时，服务端顺手把对话内容读出来随页面流式发下去，浏览器不用等 JS 加载完再单独请求一次。
  // 站内点击切换（RSC 请求）时不在这里读，交给前端缓存/预取，切换不用等数据库
  const h = await headers();
  let initial: Promise<import("@/lib/types").Conversation | null> | undefined;
  if (!h.get("rsc") && (await isAuthed())) initial = getConversation(id).catch(() => null);
  return <ChatView key={id} id={id} initial={initial} />;
}
