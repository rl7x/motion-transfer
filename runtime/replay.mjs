import { createHash } from 'node:crypto';
import { loadWasm4Core } from './wasm4-core.mjs';
import { readMemoryWatches } from './memory.mjs';

export const BUTTONS = Object.freeze({
  X: 1, Z: 2, LEFT: 16, RIGHT: 32, UP: 64, DOWN: 128,
});
export const MAX_FRAMES = 36_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function createReplayRuntime(cartridge) {
  const core = await loadWasm4Core();
  const bytes = Uint8Array.from(cartridge);
  const module = await WebAssembly.compile(bytes);
  const runtime = new ReplayRuntime(module, core, sha256(bytes));
  runtime.reset();
  return runtime;
}

class ReplayRuntime {
  constructor(module, core, cartridgeHash) {
    this.module = module;
    this.core = core;
    this.provenance = { cartridgeSha256: cartridgeHash, runtime: core.provenance };
  }

  reset() {
    const c = this.core;
    this.frame = 0;
    this.faulted = false;
    this.drawCalls = [];
    this.tones = [];
    this.disk = new Uint8Array(c.STORAGE_SIZE);
    this.diskSize = 0;
    this.memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    this.data = new DataView(this.memory.buffer);
    this.framebuffer = new c.Framebuffer(this.memory.buffer);
    c.COLORS.forEach((color, index) => this.data.setUint32(c.ADDR_PALETTE + index * 4, color, true));
    this.data.setUint16(c.ADDR_DRAW_COLORS, 0x1203, true);
    this.data.setInt16(c.ADDR_MOUSE_X, 0x7fff, true);
    this.data.setInt16(c.ADDR_MOUSE_Y, 0x7fff, true);

    const env = {
      memory: this.memory,
      blit: (...args) => this.blit(...args),
      textUtf8: (pointer, length, x, y) => {
        const bytes = new Uint8Array(this.memory.buffer, pointer, length);
        this.draw('textUtf8', [pointer, length, x, y], () => this.framebuffer.drawText(bytes, x, y), {
          text: String.fromCharCode(...bytes),
        });
      },
      tone: (...args) => { this.tones.push(args); },
      diskr: (pointer, size) => {
        const length = Math.min(size, this.diskSize);
        const bytes = new Uint8Array(this.disk.buffer, 0, length);
        new Uint8Array(this.memory.buffer, pointer).set(bytes);
        return length;
      },
      diskw: (pointer, size) => {
        const length = Math.min(size, c.STORAGE_SIZE);
        this.disk.set(new Uint8Array(this.memory.buffer, pointer, length));
        this.diskSize = length;
        return length;
      },
    };
    for (const [name, method] of Object.entries({
      rect: 'drawRect', oval: 'drawOval', line: 'drawLine', hline: 'drawHLine', vline: 'drawVLine',
    })) {
      env[name] = (...args) => this.draw(name, args, () => this.framebuffer[method](...args));
    }

    this.instance = new WebAssembly.Instance(this.module, { env });
    for (const name of ['_start', '_initialize', 'start']) {
      if (typeof this.instance.exports[name] === 'function') this.instance.exports[name]();
    }
    if (typeof this.instance.exports.update !== 'function') {
      throw new Error('Cartridge does not export an update function');
    }
    return this.observe();
  }

  draw(name, args, render, extra = {}) {
    this.drawCalls.push({
      name, args, drawColors: this.data.getUint16(this.core.ADDR_DRAW_COLORS, true), ...extra,
    });
    render();
  }

  blit(pointer, x, y, width, height, flags) {
    const sprite = new Uint8Array(this.memory.buffer, pointer);
    const size = Math.ceil(width * height * ((flags & 1) ? 2 : 1) / 8);
    this.draw('blit', [pointer, x, y, width, height, flags], () => {
      this.framebuffer.blit(sprite, x, y, width, height, 0, 0, width,
        flags & 1, flags & 2, flags & 4, flags & 8);
    }, { spriteSha256: sha256(sprite.subarray(0, size)) });
  }

  step(buttonMask, frames = 1) {
    if (this.faulted) throw new Error('Cartridge trapped; reset before stepping again');
    if (!Number.isInteger(buttonMask) || buttonMask < 0 || buttonMask > 255 || (buttonMask & 0x0c)) {
      throw new RangeError('buttonMask must contain only the documented WASM-4 gamepad bits');
    }
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > MAX_FRAMES) {
      throw new RangeError(`frames must be an integer from 1 to ${MAX_FRAMES}`);
    }
    for (let index = 0; index < frames; index++) {
      this.drawCalls = [];
      this.tones = [];
      this.data.setUint8(this.core.ADDR_GAMEPAD1, buttonMask);
      if (!(this.data.getUint8(this.core.ADDR_SYSTEM_FLAGS) & this.core.SYSTEM_PRESERVE_FRAMEBUFFER)) {
        this.framebuffer.clear();
      }
      try {
        this.instance.exports.update();
      } catch (error) {
        this.faulted = true;
        throw new Error(`Cartridge update failed at frame ${this.frame + 1}: ${error.message}`, { cause: error });
      }
      this.frame++;
    }
    return this.observe();
  }

  readMemory(watches) {
    return readMemoryWatches(this.memory.buffer, watches);
  }

  observe() {
    return {
      frame: this.frame,
      framebufferHash: sha256(this.framebuffer.bytes),
      memoryHash: sha256(new Uint8Array(this.memory.buffer)),
      palette: Array.from({ length: 4 }, (_, index) => this.data.getUint32(this.core.ADDR_PALETTE + index * 4, true)),
      storage: { bytes: this.diskSize, hash: sha256(this.disk.subarray(0, this.diskSize)) },
      drawCalls: structuredClone(this.drawCalls),
      tones: structuredClone(this.tones),
    };
  }
}
