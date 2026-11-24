import { DrawStudio } from "@/components/draw/DrawStudio";

export const metadata = { title: "画图 · Prism" };

/** 独立的画图工作台（对话里的生图照常可用，这里是专门画图的入口） */
export default function DrawPage() {
  return <DrawStudio />;
}
