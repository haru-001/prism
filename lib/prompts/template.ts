/** 提示词里的模板变量：{argument name="character" default="Albedo"} → 详情页里的填空 */

export const ARG_RE = /\{argument name="([^"]*)" default="([^"]*)"\}/g;

export interface PromptVar {
  name: string;
  def: string;
}

export function parseVars(text: string): PromptVar[] {
  return Array.from(text.matchAll(ARG_RE), (m) => ({ name: m[1], def: m[2] }));
}

/** 按出现顺序填入；没填的用默认值 */
export function fillVars(text: string, vals: (string | undefined)[]): string {
  let k = 0;
  return text.replace(ARG_RE, (_, _n: string, d: string) => {
    const v = vals[k++];
    return v != null && v !== "" ? v : d;
  });
}

/** 拆成文本段和变量段，详情里高亮显示 */
export function splitVars(text: string): ({ t: string } | { i: number; name: string; def: string })[] {
  const out: ({ t: string } | { i: number; name: string; def: string })[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(ARG_RE)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index) });
    out.push({ i: i++, name: m[1], def: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}
