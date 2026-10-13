// Minimal protobuf codec for the fields observed in the Douyin PC IM bundles.

export class Writer {
  constructor() {
    this.chunks = [];
  }

  finish() {
    const size = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = Buffer.allocUnsafe(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      chunk.copy(out, offset);
      offset += chunk.length;
    }
    return out;
  }

  varint(value) {
    let current = BigInt(value);
    if (current < 0n) {
      throw new Error("negative varint is not used by this client");
    }
    const bytes = [];
    do {
      let byte = Number(current & 0x7fn);
      current >>= 7n;
      if (current > 0n) byte |= 0x80;
      bytes.push(byte);
    } while (current > 0n);
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  key(field, wire) {
    return this.varint((field << 3) | wire);
  }

  int32(field, value) {
    this.key(field, 0);
    this.varint(value);
    return this;
  }

  int64(field, value) {
    this.key(field, 0);
    this.varint(value);
    return this;
  }

  bool(field, value) {
    return this.int32(field, value ? 1 : 0);
  }

  bytes(field, value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.key(field, 2);
    this.varint(buffer.length);
    this.chunks.push(buffer);
    return this;
  }

  string(field, value) {
    if (value === undefined || value === null || value === "") return this;
    return this.bytes(field, Buffer.from(String(value), "utf8"));
  }

  message(field, writer) {
    return this.bytes(field, writer.finish());
  }

  map(field, object) {
    if (!object) return this;
    for (const [key, value] of Object.entries(object)) {
      const entry = new Writer();
      entry.string(1, key);
      entry.string(2, value === undefined || value === null ? "" : String(value));
      this.message(field, entry);
    }
    return this;
  }
}

export class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  get done() {
    return this.offset >= this.buffer.length;
  }

  varint() {
    let value = 0n;
    let shift = 0n;
    while (this.offset < this.buffer.length) {
      const byte = this.buffer[this.offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 70n) throw new Error("varint too long");
    }
    throw new Error("truncated varint");
  }

  key() {
    const raw = this.varint();
    return { field: Number(raw >> 3n), wire: Number(raw & 7n) };
  }

  skip(wire) {
    if (wire === 0) {
      this.varint();
      return;
    }
    if (wire === 1) {
      this.offset += 8;
      return;
    }
    if (wire === 2) {
      const length = Number(this.varint());
      this.offset += length;
      return;
    }
    if (wire === 5) {
      this.offset += 4;
      return;
    }
    throw new Error(`unsupported wire type ${wire}`);
  }

  bytes() {
    const length = Number(this.varint());
    const start = this.offset;
    this.offset += length;
    return this.buffer.subarray(start, this.offset);
  }

  string() {
    return this.bytes().toString("utf8");
  }

  message() {
    return new Reader(this.bytes());
  }
}
