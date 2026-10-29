import "server-only";
import crypto from "node:crypto";
import { secretOrDev } from "./env";

function keyFor(purpose: string) {
  return crypto.createHash("sha256").update(`${secretOrDev()}:${purpose}`).digest();
}

/** AES-256-GCM 加密上游 Key */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor("enc"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decrypt(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1") throw new Error("unknown cipher version");
  const d = crypto.createDecipheriv("aes-256-gcm", keyFor("enc"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function hmac(data: string): string {
  return crypto.createHmac("sha256", keyFor("sign")).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return `s1.${salt.toString("base64url")}.${h.toString("base64url")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [v, salt, h] = stored.split(".");
  if (v !== "s1") return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, "base64url"), 32);
  return crypto.timingSafeEqual(got, Buffer.from(h, "base64url"));
}

export function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("base64url").slice(0, 16);
}

export function randomId(len = 12): string {
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

export function newApiToken(): string {
  return "sk-prism-" + crypto.randomBytes(24).toString("hex");
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••";
  const prefix = k.startsWith("sk-ant-") ? "sk-ant-" : k.startsWith("sk-") ? "sk-" : k.slice(0, 3);
  return `${prefix}••••${k.slice(-3)}`;
}
