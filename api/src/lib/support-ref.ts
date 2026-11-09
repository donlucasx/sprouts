import { randomInt } from "node:crypto";

/** 11-01 (his ruling A): a short reference per message, "S-" and 4 characters with no look-alikes (no 0/O, 1/I/L), for his email subject.
 *  11-08: shared by Message us and the answers that carry a note or an email (feedback route). */
const REF_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newSupportRef = () => `S-${Array.from({ length: 4 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join("")}`;
export const isSupportRef = (v: unknown): v is string => typeof v === "string" && /^S-[2-9A-HJKMNP-Z]{4}$/.test(v);
