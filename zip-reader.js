/* Minimal ZIP reader for Instagram JSON exports.
   Supports ZIP method 0 (stored) and 8 (deflate) using the browser's native
   DecompressionStream API. No network dependency. */
(function (global) {
  'use strict';

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;
  const decoder = new TextDecoder('utf-8');

  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }

  function findEOCD(view) {
    const min = Math.max(0, view.byteLength - 0xFFFF - 22);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (u32(view, i) === SIG_EOCD) return i;
    }
    throw new Error('No se encontró el directorio ZIP. El archivo puede estar dañado o no ser un ZIP válido.');
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no soporta la descompresión ZIP nativa. Actualiza Chrome/Samsung Internet e inténtalo de nuevo.');
    }
    let ds;
    try {
      ds = new DecompressionStream('deflate-raw');
    } catch (err) {
      throw new Error('Tu navegador no soporta deflate-raw, necesario para leer esta exportación ZIP.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  }

  class ZipReader {
    constructor(arrayBuffer) {
      this.buffer = arrayBuffer;
      this.view = new DataView(arrayBuffer);
      this.bytes = new Uint8Array(arrayBuffer);
      this.entries = this._readDirectory();
    }

    static async fromFile(file) {
      return new ZipReader(await file.arrayBuffer());
    }

    _readDirectory() {
      const eocd = findEOCD(this.view);
      const total = u16(this.view, eocd + 10);
      let offset = u32(this.view, eocd + 16);
      const entries = [];

      for (let i = 0; i < total; i++) {
        if (u32(this.view, offset) !== SIG_CENTRAL) {
          throw new Error('Directorio ZIP inválido.');
        }
        const flags = u16(this.view, offset + 8);
        const method = u16(this.view, offset + 10);
        const compressedSize = u32(this.view, offset + 20);
        const uncompressedSize = u32(this.view, offset + 24);
        const nameLen = u16(this.view, offset + 28);
        const extraLen = u16(this.view, offset + 30);
        const commentLen = u16(this.view, offset + 32);
        const localOffset = u32(this.view, offset + 42);
        const nameBytes = this.bytes.slice(offset + 46, offset + 46 + nameLen);
        const name = decoder.decode(nameBytes);

        entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
        offset += 46 + nameLen + extraLen + commentLen;
      }
      return entries;
    }

    list() { return this.entries.map(e => e.name); }

    find(predicate) { return this.entries.find(predicate); }

    async readEntry(entry) {
      if (!entry) throw new Error('Archivo ZIP no encontrado.');
      const o = entry.localOffset;
      if (u32(this.view, o) !== SIG_LOCAL) throw new Error(`Cabecera ZIP inválida para ${entry.name}.`);
      const nameLen = u16(this.view, o + 26);
      const extraLen = u16(this.view, o + 28);
      const start = o + 30 + nameLen + extraLen;
      const compressed = this.bytes.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return compressed;
      if (entry.method === 8) return inflateRaw(compressed);
      throw new Error(`Método de compresión ZIP no compatible (${entry.method}) en ${entry.name}.`);
    }

    async text(entry) {
      return decoder.decode(await this.readEntry(entry));
    }

    async json(entry) {
      const text = await this.text(entry);
      try { return JSON.parse(text); }
      catch (err) { throw new Error(`No se pudo interpretar ${entry.name} como JSON.`); }
    }
  }

  global.InstaZip = { ZipReader };
})(typeof window !== 'undefined' ? window : globalThis);
