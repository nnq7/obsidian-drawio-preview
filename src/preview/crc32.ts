/**
 * 手写 CRC32（体积最小优先 ✓）。
 *
 * 用途：**只判断 .drawio 内容有没有变** ✓ —— 不是安全哈希 ✓（用户明确不需要安全校验 ✓）。
 * 实现：16 项 nibble 表（比 256 项表省 ~1KB 代码，速度对几十 KB 的 XML 足够 ✓）。
 * 注意：按 **UTF-8 字节** 计算 ✓（drawio 里中文很多，按 charCode 会与标准 CRC32 不一致 ✗）。
 */

const TABLE = (() => {
  const t = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    let c = i;
    for (let k = 0; k < 4; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** 返回无符号 32 位 CRC（与标准 zlib CRC32 一致 ✓）。 */
export function crc32(text: string): number {
  const bytes = new TextEncoder().encode(text);
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    c = TABLE[(c ^ b) & 0x0f]! ^ (c >>> 4);
    c = TABLE[(c ^ (b >>> 4)) & 0x0f]! ^ (c >>> 4);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 便于放进文件名：定长 8 位小写十六进制 ✓（如 `a1b2c3d4`）。 */
export function crc32Hex(text: string): string {
  return crc32(text).toString(16).padStart(8, '0');
}
