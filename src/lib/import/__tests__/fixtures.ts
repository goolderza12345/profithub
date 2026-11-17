import fs from "node:fs";
import path from "node:path";
import { readSourceFile, type SourceFile } from "../table";

export const FIXTURES = path.join(process.cwd(), "e2e", "fixtures");

export function fixtureBuffer(name: string): ArrayBuffer {
  const b = fs.readFileSync(path.join(FIXTURES, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export async function readFixture(name: string): Promise<SourceFile> {
  const r = await readSourceFile(name, fixtureBuffer(name));
  if (!r.ok) throw new Error(r.error);
  return r.file;
}

export const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
