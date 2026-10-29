import { ChatView } from "@/components/chat/ChatView";

export default async function Home({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  return <ChatView key={sp.new || "home"} />;
}
